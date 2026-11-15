import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isPlan } from "@/lib/plan";
import { submitSong } from "@/lib/edit";
import { clipSecondsFor } from "@/lib/video";
import { cutLengths, totalSeconds, type EditPlan } from "@/lib/timeline";
import { friendlyError } from "@/lib/errors";

export const maxDuration = 60;

// An edit that hasn't finished after this long is treated as abandoned and can be restarted.
const STALE_MS = 15 * 60 * 1000;

type MovieRow = {
  id: string;
  status: string;
  song_mode: "ai" | "upload";
  song_mood: string | null;
  song_path: string | null;
  director_plan: unknown;
  song_status: string;
  ai_song_path: string | null;
  ai_song_seconds: number | null;
  updated_at: string;
};

type PhotoRow = { id: string; clip_path: string | null; clip_status: string; clip_seconds: number | null };

// Makes the finished movie: the song first (for new-song movies), then the edit.
// The edit itself runs on the server when the movie page next checks progress (see edit-progress).
// Send { "newSong": true } to make a fresh song instead of reusing the last one.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as { newSong?: unknown };
  const newSong = body.newSong === true;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Your session ended. Sign in again." }, { status: 401 });

  const { data: movieData } = await supabase
    .from("projects")
    .select(
      "id, status, song_mode, song_mood, song_path, director_plan, song_status, ai_song_path, ai_song_seconds, updated_at",
    )
    .eq("id", id)
    .maybeSingle();
  if (!movieData) return NextResponse.json({ error: "This movie doesn't exist." }, { status: 404 });
  const movie = movieData as unknown as MovieRow;

  const plan = isPlan(movie.director_plan) ? movie.director_plan : null;
  if (!plan) return NextResponse.json({ error: "Plan and animate the movie first." }, { status: 400 });

  if (["directing", "styling", "generating"].includes(movie.status)) {
    return NextResponse.json({ error: "Wait for the clips to finish first." }, { status: 409 });
  }
  const recent = Date.now() - new Date(movie.updated_at).getTime() < STALE_MS;
  if (movie.status === "editing" && recent) {
    return NextResponse.json({ error: "This movie is already being edited." }, { status: 409 });
  }

  const { data: photoData } = await supabase
    .from("project_images")
    .select("id, clip_path, clip_status, clip_seconds")
    .eq("project_id", id);
  const photoById = new Map(((photoData ?? []) as unknown as PhotoRow[]).map((p) => [p.id, p]));

  // Shots in plan order that have a finished clip. Shots without one are left out.
  const ready = plan.shots.flatMap((shot) => {
    const photo = photoById.get(shot.image_id);
    if (!photo || photo.clip_status !== "done" || !photo.clip_path) return [];
    return [{ shot, clipPath: photo.clip_path, clipSeconds: photo.clip_seconds ?? clipSecondsFor(shot.seconds) }];
  });
  if (ready.length < 2) {
    return NextResponse.json({ error: "At least 2 shots need finished clips before editing." }, { status: 400 });
  }

  // A new song is made at the plan's tempo, so cuts can land on its beat.
  const bpm = movie.song_mode === "ai" ? plan.song.bpm : null;
  const lengths = cutLengths(
    ready.map((r) => ({ seconds: r.shot.seconds, clipSeconds: r.clipSeconds })),
    bpm,
  );
  const editPlan: EditPlan = {
    cuts: ready.map((r, i) => ({ image_id: r.shot.image_id, clip_path: r.clipPath, seconds: lengths[i] })),
    total_seconds: totalSeconds(lengths),
    bpm,
  };

  const previousStatus = movie.status === "preview_ready" ? "preview_ready" : "animated";

  try {
    // Ready to edit right away: the edit is queued, and the next progress check runs it.
    const queueEdit = async () => {
      const { error } = await supabase
        .from("projects")
        .update({
          status: "editing",
          error: null,
          edit_plan: editPlan,
          edit_status: "queued",
          edit_request_id: null,
        })
        .eq("id", id);
      if (error) throw new Error(error.message);
      return NextResponse.json({ ok: true, stage: "edit" });
    };

    if (movie.song_mode === "upload") {
      if (!movie.song_path) throw new Error("Your song file is missing. Create the movie again with your song.");
      return await queueEdit();
    }

    // New-song movies reuse the last song if it's long enough, unless a new one was asked for.
    const songFits =
      movie.song_status === "done" &&
      Boolean(movie.ai_song_path) &&
      (movie.ai_song_seconds ?? 0) >= editPlan.total_seconds - 0.5;

    if (!newSong && songFits && movie.ai_song_path) return await queueEdit();

    const requestId = await submitSong(plan.song, movie.song_mood, editPlan.total_seconds);
    await supabase
      .from("projects")
      .update({
        status: "editing",
        error: null,
        edit_plan: editPlan,
        song_status: "queued",
        song_request_id: requestId,
        edit_status: "none",
        edit_request_id: null,
      })
      .eq("id", id);
    return NextResponse.json({ ok: true, stage: "song" });
  } catch (err) {
    const message = friendlyError(err);
    await supabase.from("projects").update({ status: previousStatus, error: message }).eq("id", id);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
