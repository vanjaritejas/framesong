"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Counts = { total: number; done: number; failed: number; pending: number };
type Phase = "idle" | "planning" | "styling" | "ready";

type Props = {
  movieId: string;
  status: string;
  hasPlan: boolean;
  restyles: boolean;
  styleName: string;
  counts: Counts;
  error: string | null;
};

function phaseFor(status: string, hasPlan: boolean): Phase {
  if (status === "directing") return "planning";
  if (status === "styling") return "styling";
  return hasPlan ? "ready" : "idle";
}

export default function MoviePlanner({
  movieId,
  status,
  hasPlan,
  restyles,
  styleName,
  counts: initialCounts,
  error,
}: Props) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>(phaseFor(status, hasPlan));
  const [counts, setCounts] = useState<Counts>(initialCounts);
  const [reorder, setReorder] = useState(true);
  const [message, setMessage] = useState<string | null>(error);
  const [requesting, setRequesting] = useState(false);
  const doneRef = useRef(initialCounts.done);

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

  // Planning started in another tab or before a reload: check back every few seconds.
  useEffect(() => {
    if (phase !== "planning" || requesting) return;
    const timer = setInterval(() => router.refresh(), 5000);
    return () => clearInterval(timer);
  }, [phase, requesting, router]);

  // While photos are being redrawn, collect finished ones every few seconds.
  useEffect(() => {
    if (phase !== "styling") return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function tick() {
      try {
        const res = await fetch(`/api/movies/${movieId}/progress`, { method: "POST" });
        const data = (await res.json()) as Partial<Counts> & { error?: string };
        if (stopped) return;
        if (!res.ok) {
          setMessage(data.error ?? "Redraw progress couldn't be checked. Reload the page to try again.");
        } else {
          const next: Counts = {
            total: data.total ?? 0,
            done: data.done ?? 0,
            failed: data.failed ?? 0,
            pending: data.pending ?? 0,
          };
          setCounts(next);
          if (next.done !== doneRef.current) {
            doneRef.current = next.done;
            router.refresh(); // Show newly redrawn photos.
          }
          if (next.pending === 0) {
            setPhase("ready");
            router.refresh();
            return;
          }
        }
      } catch {
        // Connection hiccup: try again on the next tick.
      }
      if (!stopped) timer = setTimeout(tick, 4000);
    }

    tick();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [phase, movieId, router]);

  async function planMovie() {
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
        setPhase(hasPlan ? "ready" : "idle");
        return;
      }
      if (data.warning) setMessage(data.warning);
      setPhase(data.restyling ? "styling" : "ready");
      router.refresh();
    } catch {
      setMessage("The connection dropped while planning. Reload the page to see whether the plan finished.");
      setPhase(hasPlan ? "ready" : "idle");
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
      setCounts((c) => ({ ...c, failed: 0, pending: c.pending + (data.submitted ?? 0) }));
      setPhase("styling");
      router.refresh();
    } catch {
      setMessage("The connection dropped. Check your internet, then try again.");
    } finally {
      setRequesting(false);
    }
  }

  const finished = counts.done + counts.failed;

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
          <label className="check">
            <input
              type="checkbox"
              checked={reorder}
              onChange={(e) => setReorder(e.target.checked)}
            />
            Let Claude choose the photo order
          </label>
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
            Claude is looking at your photos and writing the plan. This takes up to a minute.
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
            value={finished}
            max={Math.max(counts.total, 1)}
            aria-label="Redraw progress"
          />
        </>
      )}

      {phase === "ready" && (
        <>
          <p>The plan is ready. Check the shots and the song below.</p>
          <label className="check">
            <input
              type="checkbox"
              checked={reorder}
              onChange={(e) => setReorder(e.target.checked)}
              disabled={requesting}
            />
            Let Claude choose the photo order
          </label>
          <div className="planner-actions">
            <button type="button" className="btn btn-primary" disabled>
              Animate movie
            </button>
            <button type="button" className="btn btn-quiet" onClick={planMovie} disabled={requesting}>
              Plan again
            </button>
            {restyles && counts.failed > 0 && (
              <button type="button" className="btn btn-quiet" onClick={redrawFailed} disabled={requesting}>
                Redraw {counts.failed} photo{counts.failed === 1 ? "" : "s"}
              </button>
            )}
          </div>
          <p className="hint">Animating arrives in the next update. Planning again keeps photos that are already redrawn.</p>
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
