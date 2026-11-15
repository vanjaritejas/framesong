import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { needsRestyle, submitRestyles } from "@/lib/restyle";
import { friendlyError } from "@/lib/errors";
import type { AspectId, StyleId } from "@/lib/constants";

export const maxDuration = 60;

// Tries the redraw again for photos that failed.
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Your session ended. Sign in again." }, { status: 401 });

  const { data: movieData } = await supabase
    .from("projects")
    .select("id, style, aspect_ratio")
    .eq("id", id)
    .maybeSingle();
  if (!movieData) return NextResponse.json({ error: "This movie doesn't exist." }, { status: 404 });
  const movie = movieData as unknown as { id: string; style: StyleId; aspect_ratio: AspectId };
  if (!needsRestyle(movie.style)) {
    return NextResponse.json({ error: "Real nature movies keep the original photos." }, { status: 400 });
  }

  const { data: photoData } = await supabase
    .from("project_images")
    .select("id, storage_path, style_status")
    .eq("project_id", id)
    .in("style_status", ["failed", "none"]);
  const todo = (photoData ?? []) as unknown as { id: string; storage_path: string }[];
  if (todo.length === 0) return NextResponse.json({ ok: true, submitted: 0 });

  try {
    const result = await submitRestyles(supabase, { style: movie.style, aspect: movie.aspect_ratio }, todo);
    if (result.submitted === 0) throw new Error(result.firstError ?? "Redrawing couldn't start.");
    await supabase.from("projects").update({ status: "styling", error: null }).eq("id", id);
    return NextResponse.json({ ok: true, submitted: result.submitted });
  } catch (err) {
    return NextResponse.json({ error: friendlyError(err) }, { status: 500 });
  }
}
