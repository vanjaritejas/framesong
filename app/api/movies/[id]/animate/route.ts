import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isPlan } from "@/lib/plan";
import { submitClips, type ClipJob } from "@/lib/animate";
import { friendlyError } from "@/lib/errors";
import { needsRestyle, type AspectId, type StyleId } from "@/lib/constants";

// Preparing big photos and starting every job can take a little while.
export const maxDuration = 120;

// Animating that hasn't finished after this long is treated as abandoned and can be restarted.
const STALE_MS = 20 * 60 * 1000;

type MovieRow = {
  id: string;
  style: StyleId;
  aspect_ratio: AspectId;
  status: string;
  director_plan: unknown;
  updated_at: string;
};

type PhotoRow = {
  id: string;
  storage_path: string;
  styled_path: string | null;
  style_status: string;
  clip_status: string;
  motion_prompt: string | null;
};

// Starts making a video clip for every shot that doesn't have one yet.
// Send { "retryFailed": true } to only try the shots that failed.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as { retryFailed?: unknown };
  const retryFailed = body.retryFailed === true;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Your session ended. Sign in again." }, { status: 401 });

  const { data: movieData } = await supabase
    .from("projects")
    .select("id, style, aspect_ratio, status, director_plan, updated_at")
    .eq("id", id)
    .maybeSingle();
  if (!movieData) return NextResponse.json({ error: "This movie doesn't exist." }, { status: 404 });
  const movie = movieData as unknown as MovieRow;

  const plan = isPlan(movie.director_plan) ? movie.director_plan : null;
  if (!plan) return NextResponse.json({ error: "Plan the movie first, then animate it." }, { status: 400 });

  if (movie.status === "directing" || movie.status === "styling") {
    return NextResponse.json({ error: "Wait for planning and redrawing to finish." }, { status: 409 });
  }
  const recent = Date.now() - new Date(movie.updated_at).getTime() < STALE_MS;
  if (movie.status === "generating" && recent) {
    return NextResponse.json({ error: "This movie is already being animated." }, { status: 409 });
  }

  const { data: photoData } = await supabase
    .from("project_images")
    .select("id, storage_path, styled_path, style_status, clip_status, motion_prompt")
    .eq("project_id", id);
  const photos = (photoData ?? []) as unknown as PhotoRow[];

  const restyles = needsRestyle(movie.style);
  if (restyles && photos.some((p) => p.style_status !== "done")) {
    return NextResponse.json(
      { error: "Some photos aren't redrawn yet. Select Redraw to finish them, then animate." },
      { status: 400 },
    );
  }

  const shotById = new Map(plan.shots.map((s) => [s.image_id, s]));
  const todo = photos.filter((p) => (retryFailed ? p.clip_status === "failed" : p.clip_status !== "done"));
  if (todo.length === 0) return NextResponse.json({ ok: true, submitted: 0 });

  const jobs: ClipJob[] = todo.map((p) => {
    const shot = shotById.get(p.id);
    return {
      id: p.id,
      storage_path: p.storage_path,
      styled_path: p.styled_path,
      motion: shot?.motion ?? p.motion_prompt ?? "",
      seconds: shot?.seconds ?? 5,
    };
  });

  await supabase.from("projects").update({ status: "generating", error: null }).eq("id", id);

  try {
    const result = await submitClips(
      supabase,
      { id, userId: user.id, style: movie.style, aspect: movie.aspect_ratio, useStyled: restyles },
      jobs,
    );
    if (result.submitted === 0) throw new Error(result.firstError ?? "Animating couldn't start.");
    return NextResponse.json({ ok: true, submitted: result.submitted });
  } catch (err) {
    const message = friendlyError(err);
    const hasClips = photos.some((p) => p.clip_status === "done");
    await supabase
      .from("projects")
      .update({ status: hasClips ? "animated" : "planned", error: message })
      .eq("id", id);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
