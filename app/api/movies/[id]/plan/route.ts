import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { BUCKET } from "@/lib/storage";
import { planMovie } from "@/lib/director";
import { needsRestyle, submitRestyles } from "@/lib/restyle";
import { friendlyError } from "@/lib/errors";
import type { AspectId, StyleId } from "@/lib/constants";

// Planning reads every photo and waits for Claude, which can take up to a minute.
export const maxDuration = 300;

// A plan stuck "in progress" this long is treated as abandoned and can be restarted.
const STALE_MS = 5 * 60 * 1000;

type MovieRow = {
  id: string;
  title: string;
  style: StyleId;
  aspect_ratio: AspectId;
  song_mode: "ai" | "upload";
  song_mood: string | null;
  song_notes: string | null;
  status: string;
  updated_at: string;
};

type PhotoRow = { id: string; storage_path: string; position: number; style_status: string };

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as { reorder?: unknown };
  const reorder = body.reorder !== false;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Your session ended. Sign in again, then plan the movie." }, { status: 401 });
  }

  const { data: movieData } = await supabase
    .from("projects")
    .select("id, title, style, aspect_ratio, song_mode, song_mood, song_notes, status, updated_at")
    .eq("id", id)
    .maybeSingle();
  if (!movieData) {
    return NextResponse.json({ error: "This movie doesn't exist or belongs to another account." }, { status: 404 });
  }
  const movie = movieData as unknown as MovieRow;

  const inProgress = movie.status === "directing" || movie.status === "styling";
  if (inProgress && Date.now() - new Date(movie.updated_at).getTime() < STALE_MS) {
    return NextResponse.json({ error: "This movie is already being planned. Wait for it to finish." }, { status: 409 });
  }
  if (movie.status === "generating" && Date.now() - new Date(movie.updated_at).getTime() < 4 * STALE_MS) {
    return NextResponse.json({ error: "Wait for the clips to finish before planning again." }, { status: 409 });
  }

  const { data: photoData } = await supabase
    .from("project_images")
    .select("id, storage_path, position, style_status")
    .eq("project_id", id)
    .order("position", { ascending: true });
  const photos = (photoData ?? []) as unknown as PhotoRow[];
  if (photos.length < 3) {
    return NextResponse.json({ error: "Add at least 3 photos before planning the movie." }, { status: 400 });
  }

  const previousStatus = inProgress ? "draft" : movie.status === "generating" ? "planned" : movie.status;
  await supabase.from("projects").update({ status: "directing", error: null }).eq("id", id);

  try {
    // 1. Read the photos from storage.
    const files = await Promise.all(
      photos.map(async (p) => {
        const { data, error } = await supabase.storage.from(BUCKET).download(p.storage_path);
        if (error || !data) throw new Error(`Photo ${p.position + 1} couldn't be read from storage.`);
        return { id: p.id, data: Buffer.from(await data.arrayBuffer()) };
      }),
    );

    // 2. Ask Claude for the plan.
    const plan = await planMovie({
      photos: files,
      style: movie.style,
      aspect: movie.aspect_ratio,
      songMode: movie.song_mode,
      mood: movie.song_mood,
      notes: movie.song_notes,
      reorder,
    });

    // 3. Save the new photo order and each shot's motion.
    //    A new plan means new motion, so any clips from the old plan are cleared.
    const updates = await Promise.all(
      plan.shots.map((shot, index) =>
        supabase
          .from("project_images")
          .update({
            position: index,
            motion_prompt: shot.motion,
            clip_status: "pending",
            clip_path: null,
            clip_request_id: null,
            clip_error: null,
          })
          .eq("id", shot.image_id),
      ),
    );
    const failedUpdate = updates.find((u) => u.error);
    if (failedUpdate?.error) throw new Error(`The shot order couldn't be saved: ${failedUpdate.error.message}`);

    const restyle = needsRestyle(movie.style);
    const todo = restyle ? photos.filter((p) => p.style_status !== "done") : [];

    const { error: saveError } = await supabase
      .from("projects")
      .update({
        director_plan: plan,
        title: movie.title === "Untitled movie" && plan.title ? plan.title : movie.title,
        status: todo.length > 0 ? "styling" : "planned",
        error: null,
      })
      .eq("id", id);
    if (saveError) throw new Error(`The plan couldn't be saved: ${saveError.message}`);

    // 4. Cartoon and 3D movies: start redrawing photos that aren't redrawn yet.
    if (todo.length > 0) {
      const result = await submitRestyles(supabase, { style: movie.style, aspect: movie.aspect_ratio }, todo);
      if (result.submitted === 0) {
        const warning = `The plan is ready, but redrawing couldn't start: ${friendlyError(new Error(result.firstError ?? ""))}`;
        await supabase.from("projects").update({ status: "planned", error: warning }).eq("id", id);
        return NextResponse.json({ ok: true, restyling: false, warning });
      }
    }

    return NextResponse.json({ ok: true, restyling: todo.length > 0 });
  } catch (err) {
    const message = friendlyError(err);
    await supabase.from("projects").update({ status: previousStatus, error: message }).eq("id", id);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
