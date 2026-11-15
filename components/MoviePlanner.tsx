"use client";

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import type { ClipEstimate } from "@/lib/video";
import type { EditEstimate } from "@/lib/timeline";

type Counts = { total: number; done: number; failed: number; pending: number };
type Phase = "idle" | "planning" | "styling" | "ready" | "animating" | "animated" | "editing" | "finished";
type EditStage = "song" | "edit";

type Props = {
  movieId: string;
  status: string;
  hasPlan: boolean;
  restyles: boolean;
  styleName: string;
  counts: Counts; // photo redraws
  clipCounts: Counts; // video clips
  canAnimate: boolean; // every photo is redrawn (or the look doesn't need redraws)
  estimate: ClipEstimate; // for the shots that don't have a finished clip yet
  songMode: "ai" | "upload";
  editEstimate: EditEstimate; // making the movie (reuses the last song when it fits)
  newSongEstimate: EditEstimate; // making the movie with a fresh song
  editStage: EditStage | null; // what's running right now, if editing
  hasMovie: boolean; // a finished movie exists
  error: string | null;
};

function phaseFor(status: string, hasPlan: boolean): Phase {
  if (status === "directing") return "planning";
  if (status === "styling") return "styling";
  if (status === "generating") return "animating";
  if (status === "animated") return "animated";
  if (status === "editing") return "editing";
  if (status === "preview_ready") return "finished";
  return hasPlan ? "ready" : "idle";
}

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function creditText(dollars: number) {
  return dollars > 0 ? `about $${dollars.toFixed(2)} of fal.ai credit` : "no fal.ai credit";
}

// Checks a progress endpoint every few seconds until nothing is pending.
function usePolling(
  active: boolean,
  url: string,
  everyMs: number,
  onCounts: (counts: Counts) => void,
  onError: (message: string) => void,
) {
  const onCountsRef = useRef(onCounts);
  const onErrorRef = useRef(onError);
  useEffect(() => {
    onCountsRef.current = onCounts;
    onErrorRef.current = onError;
  });

  useEffect(() => {
    if (!active) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function tick() {
      let keepGoing = true;
      try {
        const res = await fetch(url, { method: "POST" });
        const data = (await res.json()) as Partial<Counts> & { error?: string };
        if (stopped) return;
        if (!res.ok) {
          onErrorRef.current(data.error ?? "Progress couldn't be checked. Reload the page to try again.");
        } else {
          const next: Counts = {
            total: data.total ?? 0,
            done: data.done ?? 0,
            failed: data.failed ?? 0,
            pending: data.pending ?? 0,
          };
          onCountsRef.current(next);
          if (next.pending === 0) keepGoing = false;
        }
      } catch {
        // Connection hiccup: try again on the next tick.
      }
      if (!stopped && keepGoing) timer = setTimeout(tick, everyMs);
    }

    tick();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [active, url, everyMs]);
}

export default function MoviePlanner({
  movieId,
  status,
  hasPlan,
  restyles,
  styleName,
  counts: initialCounts,
  clipCounts: initialClipCounts,
  canAnimate,
  estimate,
  songMode,
  editEstimate,
  newSongEstimate,
  editStage: initialEditStage,
  hasMovie,
  error,
}: Props) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>(phaseFor(status, hasPlan));
  const [counts, setCounts] = useState<Counts>(initialCounts);
  const [clipCounts, setClipCounts] = useState<Counts>(initialClipCounts);
  const [reorder, setReorder] = useState(true);
  const [message, setMessage] = useState<string | null>(error);
  const [requesting, setRequesting] = useState(false);
  const [editStage, setEditStage] = useState<EditStage>(initialEditStage ?? "song");
  const doneRef = useRef(initialCounts.done);
  const clipDoneRef = useRef(initialClipCounts.done);

  // Follow the saved status whenever the page refreshes.
  useEffect(() => {
    setPhase(phaseFor(status, hasPlan));
  }, [status, hasPlan]);

  useEffect(() => {
    setMessage(error);
  }, [error]);

  const { total, done, failed, pending } = initialCounts;
  useEffect(() => {
    setCounts({ total, done, failed, pending });
  }, [total, done, failed, pending]);

  const c = initialClipCounts;
  useEffect(() => {
    setClipCounts({ total: c.total, done: c.done, failed: c.failed, pending: c.pending });
  }, [c.total, c.done, c.failed, c.pending]);

  // Planning started in another tab or before a reload: check back every few seconds.
  useEffect(() => {
    if (phase !== "planning" || requesting) return;
    const timer = setInterval(() => router.refresh(), 5000);
    return () => clearInterval(timer);
  }, [phase, requesting, router]);

  // While photos are being redrawn, collect finished ones every few seconds.
  usePolling(
    phase === "styling",
    `/api/movies/${movieId}/progress`,
    4000,
    (next) => {
      setCounts(next);
      if (next.done !== doneRef.current) {
        doneRef.current = next.done;
        router.refresh(); // Show newly redrawn photos.
      }
      if (next.pending === 0) {
        setPhase("ready");
        router.refresh();
      }
    },
    setMessage,
  );

  // While clips are being made, collect finished ones every few seconds.
  usePolling(
    phase === "animating",
    `/api/movies/${movieId}/clips`,
    5000,
    (next) => {
      setClipCounts(next);
      if (next.done !== clipDoneRef.current) {
        clipDoneRef.current = next.done;
        router.refresh(); // Show newly finished clips.
      }
      if (next.pending === 0) {
        setPhase("animated");
        router.refresh();
      }
    },
    setMessage,
  );

  useEffect(() => {
    if (initialEditStage) setEditStage(initialEditStage);
  }, [initialEditStage]);

  // While the song and the edit are being made, check every few seconds.
  useEffect(() => {
    if (phase !== "editing") return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function tick() {
      let keepGoing = true;
      try {
        const res = await fetch(`/api/movies/${movieId}/edit-progress`, { method: "POST" });
        const data = (await res.json()) as { stage?: string; error?: string };
        if (stopped) return;
        if (!res.ok) {
          setMessage(data.error ?? "Progress couldn't be checked. Reload the page to try again.");
        } else if (data.stage === "song" || data.stage === "edit") {
          setEditStage(data.stage);
        } else {
          keepGoing = false;
          if (data.stage === "done") setPhase("finished");
          if (data.stage === "failed") setMessage(data.error ?? "The movie couldn't be made. Try again.");
          router.refresh();
        }
      } catch {
        // Connection hiccup: try again on the next tick.
      }
      if (!stopped && keepGoing) timer = setTimeout(tick, 5000);
    }

    tick();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [phase, movieId, router]);

  async function planMovie() {
    if (
      (clipCounts.done > 0 || hasMovie) &&
      !window.confirm(
        "Planning again clears the clips, the song, and the finished movie. Making them again uses fal.ai credit again. Plan again?",
      )
    ) {
      return;
    }
    setRequesting(true);
    setMessage(null);
    setPhase("planning");
    try {
      const res = await fetch(`/api/movies/${movieId}/plan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reorder }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        warning?: string;
        restyling?: boolean;
      };
      if (!res.ok) {
        setMessage(data.error ?? "The plan couldn't be made. Try again.");
        setPhase(phaseFor(status, hasPlan));
        return;
      }
      if (data.warning) setMessage(data.warning);
      setPhase(data.restyling ? "styling" : "ready");
      router.refresh();
    } catch {
      setMessage("The connection dropped while planning. Reload the page to see whether the plan finished.");
      setPhase(phaseFor(status, hasPlan));
    } finally {
      setRequesting(false);
    }
  }

  async function redrawFailed() {
    setRequesting(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/movies/${movieId}/restyle`, { method: "POST" });
      const data = (await res.json().catch(() => ({}))) as { error?: string; submitted?: number };
      if (!res.ok) {
        setMessage(data.error ?? "Redrawing couldn't start. Try again.");
        return;
      }
      setCounts((prev) => ({ ...prev, failed: 0, pending: prev.pending + (data.submitted ?? 0) }));
      setPhase("styling");
      router.refresh();
    } catch {
      setMessage("The connection dropped. Check your internet, then try again.");
    } finally {
      setRequesting(false);
    }
  }

  async function animate(retryFailed: boolean) {
    const cost = `$${estimate.dollars.toFixed(2)}`;
    const question = `Make ${plural(estimate.clips, "clip")}, about ${estimate.seconds} seconds of video? This uses about ${cost} of your fal.ai credit.`;
    if (!window.confirm(question)) return;

    setRequesting(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/movies/${movieId}/animate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ retryFailed }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; submitted?: number };
      if (!res.ok) {
        setMessage(data.error ?? "Animating couldn't start. Try again.");
        router.refresh();
        return;
      }
      const submitted = data.submitted ?? 0;
      setClipCounts((prev) => ({
        ...prev,
        failed: retryFailed ? 0 : prev.failed,
        pending: prev.pending + submitted,
      }));
      if (submitted > 0) setPhase("animating");
      router.refresh();
    } catch {
      setMessage("The connection dropped. Reload the page to see whether animating started.");
    } finally {
      setRequesting(false);
    }
  }

  async function makeMovie(newSong: boolean) {
    const est = newSong ? newSongEstimate : editEstimate;
    const what = est.makesSong ? "Make the song and edit the movie" : "Edit the movie with the song";
    const question = `${what}? The movie is about ${est.movieSeconds} seconds long, and this uses ${creditText(est.dollars)}.`;
    if (!window.confirm(question)) return;

    setRequesting(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/movies/${movieId}/edit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newSong }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; stage?: EditStage };
      if (!res.ok) {
        setMessage(data.error ?? "The movie couldn't be started. Try again.");
        router.refresh();
        return;
      }
      setEditStage(data.stage ?? "song");
      setPhase("editing");
      router.refresh();
    } catch {
      setMessage("The connection dropped. Reload the page to see whether the edit started.");
    } finally {
      setRequesting(false);
    }
  }

  const finishedRedraws = counts.done + counts.failed;
  const finishedClips = clipCounts.done + clipCounts.failed;
  const costText = `about $${estimate.dollars.toFixed(2)} of fal.ai credit`;
  const editCost = creditText(editEstimate.dollars);
  const retryButton =
    clipCounts.failed > 0 ? (
      <button type="button" className="btn btn-quiet" onClick={() => animate(true)} disabled={requesting}>
        Try again ({plural(clipCounts.failed, "shot")})
      </button>
    ) : null;

  const reorderBox = (
    <label className="check">
      <input
        type="checkbox"
        checked={reorder}
        onChange={(e: ChangeEvent<HTMLInputElement>) => setReorder(e.target.checked)}
        disabled={requesting}
      />
      Let Claude choose the photo order
    </label>
  );

  return (
    <section className="planner" aria-labelledby="planner-title">
      <h2 id="planner-title">Make the movie</h2>

      {phase === "idle" && (
        <>
          <p>
            Claude looks at your photos, puts them in story order, plans how each shot moves, and
            writes the song.
            {restyles && ` Then every photo is redrawn in the ${styleName} look.`}
          </p>
          {reorderBox}
          <div className="planner-actions">
            <button type="button" className="btn btn-primary" onClick={planMovie} disabled={requesting}>
              Plan my movie
            </button>
          </div>
        </>
      )}

      {phase === "planning" && (
        <>
          <p role="status" className="working">
            Claude is looking at your photos and writing the plan. This takes up to a minute or two.
          </p>
          <div className="planner-actions">
            <button type="button" className="btn btn-primary" disabled>
              Planning…
            </button>
          </div>
        </>
      )}

      {phase === "styling" && (
        <>
          <p role="status" className="working">
            Redrawing photos in the {styleName} look: {counts.done} of {counts.total} done.
          </p>
          <progress
            className="meter"
            value={finishedRedraws}
            max={Math.max(counts.total, 1)}
            aria-label="Redraw progress"
          />
        </>
      )}

      {phase === "ready" && (
        <>
          <p>The plan is ready. Check the shots below, then animate them.</p>
          {reorderBox}
          <div className="planner-actions">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => animate(false)}
              disabled={requesting || !canAnimate || estimate.clips === 0}
            >
              Animate movie
            </button>
            <button type="button" className="btn btn-quiet" onClick={planMovie} disabled={requesting}>
              Plan again
            </button>
            {restyles && counts.failed > 0 && (
              <button type="button" className="btn btn-quiet" onClick={redrawFailed} disabled={requesting}>
                Redraw {plural(counts.failed, "photo")}
              </button>
            )}
          </div>
          {canAnimate ? (
            <p className="hint">
              Animating makes {plural(estimate.clips, "clip")} ({estimate.seconds} seconds of video) for{" "}
              {costText}. Planning again keeps photos that are already redrawn.
            </p>
          ) : (
            <p className="hint">Every photo needs its {styleName} redraw before animating. Redraw the missing ones first.</p>
          )}
        </>
      )}

      {phase === "animating" && (
        <>
          <p role="status" className="working">
            Animating shots: {clipCounts.done} of {clipCounts.total} done. Each clip takes a minute or two,
            and you can leave this page and come back.
          </p>
          <progress
            className="meter"
            value={finishedClips}
            max={Math.max(clipCounts.total, 1)}
            aria-label="Animation progress"
          />
        </>
      )}

      {phase === "animated" && (
        <>
          <p>
            {clipCounts.failed > 0
              ? `${clipCounts.done} of ${clipCounts.total} clips are ready. Watch them below.`
              : `All ${plural(clipCounts.total, "clip")} are ready. Watch them below.`}
          </p>
          {reorderBox}
          <div className="planner-actions">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => makeMovie(false)}
              disabled={requesting || clipCounts.done < 2}
            >
              Make the movie
            </button>
            {retryButton}
            <button type="button" className="btn btn-quiet" onClick={planMovie} disabled={requesting}>
              Plan again
            </button>
          </div>
          <p className="hint">
            {editEstimate.makesSong
              ? `Makes a new song from the lyrics, then cuts the clips to its beat. This uses ${editCost}.`
              : `Cuts the clips together with ${songMode === "ai" ? "the song" : "your song"}. The edit runs on your own server, so it uses ${editCost}.`}
            {clipCounts.failed > 0 && " Shots without a clip are left out."}
          </p>
        </>
      )}

      {phase === "editing" && (
        <>
          <p role="status" className="working">
            {editStage === "song"
              ? "Making the song: the music model is singing your lyrics. This takes a minute or two."
              : "Editing: cutting the clips to the music and laying the song underneath. This takes about a minute, so keep this page open."}
          </p>
          <ol className="edit-steps" aria-label="Steps">
            {songMode === "ai" && (
              <li data-state={editStage === "song" ? "active" : "done"}>Make the song</li>
            )}
            <li data-state={editStage === "edit" ? "active" : "waiting"}>Cut the clips and add the song</li>
          </ol>
        </>
      )}

      {phase === "finished" && (
        <>
          <p>Your movie is ready. Watch it at the top of the page.</p>
          {reorderBox}
          <div className="planner-actions">
            <button type="button" className="btn btn-quiet" onClick={() => makeMovie(false)} disabled={requesting}>
              Edit again
            </button>
            {songMode === "ai" && (
              <button type="button" className="btn btn-quiet" onClick={() => makeMovie(true)} disabled={requesting}>
                Make a new song
              </button>
            )}
            {retryButton}
            <button type="button" className="btn btn-quiet" onClick={planMovie} disabled={requesting}>
              Plan again
            </button>
          </div>
          <p className="hint">
            Edit again reuses the same song and uses {creditText(editEstimate.dollars)}.
            {songMode === "ai" && ` A new song uses ${creditText(newSongEstimate.dollars)}.`} Next update: 4K.
          </p>
        </>
      )}

      {message && (
        <p className="notice error" role="alert">
          {message}
        </p>
      )}
    </section>
  );
}
