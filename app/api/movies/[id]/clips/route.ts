import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { BUCKET } from "@/lib/storage";
import { checkClip, type ClipCheck } from "@/lib/animate";

export const maxDuration = 120;

// Video files are big, so each check saves at most this many finished clips.
// The rest are saved on the next check a few seconds later.
const MAX_SAVES_PER_CHECK = 3;

type PhotoRow = { id: string; clip_request_id: string | null; clip_status: string };

// Called every few seconds by the movie page while clips are being made.
// Collects finished clips from fal.ai and saves them to your private storage.
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Your session ended. Sign in again." }, { status: 401 });

  const { data: movie } = await supabase.from("projects").select("id, status").eq("id", id).maybeSingle();
  if (!movie) return NextResponse.json({ error: "This movie doesn't exist." }, { status: 404 });

  const { data: photoData } = await supabase
    .from("project_images")
    .select("id, clip_request_id, clip_status")
    .eq("project_id", id);
  const photos = (photoData ?? []) as unknown as PhotoRow[];

  const markFailed = async (photo: PhotoRow, reason: string) => {
    photo.clip_status = "failed";
    await supabase
      .from("project_images")
      .update({ clip_status: "failed", clip_error: reason.slice(0, 300) })
      .eq("id", photo.id);
  };

  // 1. Ask fal.ai how each active clip is doing.
  const active = photos.filter((p) => p.clip_status === "queued" || p.clip_status === "running");
  const finished: { photo: PhotoRow; url: string }[] = [];

  await Promise.all(
    active.map(async (photo) => {
      if (!photo.clip_request_id) return markFailed(photo, "The video job was lost. Animate it again.");

      let check: ClipCheck;
      try {
        check = await checkClip(photo.clip_request_id);
      } catch {
        return; // Network hiccup: check again on the next poll.
      }

      if (check.state === "pending") {
        if (check.running && photo.clip_status !== "running") {
          photo.clip_status = "running";
          await supabase.from("project_images").update({ clip_status: "running" }).eq("id", photo.id);
        }
        return;
      }
      if (check.state === "failed") return markFailed(photo, check.reason);
      finished.push({ photo, url: check.url });
    }),
  );

  // 2. Save finished clips one at a time.
  for (const { photo, url } of finished.slice(0, MAX_SAVES_PER_CHECK)) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Download failed (${res.status})`);
      const path = `${user.id}/${id}/clip-${photo.id}.mp4`;
      const { error } = await supabase.storage
        .from(BUCKET)
        .upload(path, await res.arrayBuffer(), { contentType: "video/mp4", upsert: true });
      if (error) throw new Error(error.message);
      await supabase
        .from("project_images")
        .update({ clip_path: path, clip_status: "done", clip_error: null })
        .eq("id", photo.id);
      photo.clip_status = "done";
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await markFailed(photo, `The clip was made but couldn't be saved: ${message}`);
    }
  }

  const count = (status: string) => photos.filter((p) => p.clip_status === status).length;
  const done = count("done");
  const failed = count("failed");
  const pending = count("queued") + count("running");

  if (pending === 0 && movie.status === "generating") {
    await supabase
      .from("projects")
      .update({
        status: "animated",
        error:
          failed > 0
            ? `${failed} shot${failed === 1 ? "" : "s"} couldn't be animated. Select Try again to retry ${failed === 1 ? "it" : "them"}.`
            : null,
      })
      .eq("id", id);
  }

  return NextResponse.json({ total: photos.length, done, failed, pending });
}
