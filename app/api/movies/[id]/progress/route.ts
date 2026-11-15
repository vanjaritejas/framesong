import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { BUCKET } from "@/lib/storage";
import { checkRestyle, type RestyleCheck } from "@/lib/restyle";

export const maxDuration = 60;

type PhotoRow = { id: string; style_request_id: string | null; style_status: string };

// Called every few seconds by the movie page while photos are being redrawn.
// Collects finished redraws from fal.ai and saves them to your private storage.
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
    .select("id, style_request_id, style_status")
    .eq("project_id", id);
  const photos = (photoData ?? []) as unknown as PhotoRow[];

  const markFailed = async (photo: PhotoRow) => {
    photo.style_status = "failed";
    await supabase.from("project_images").update({ style_status: "failed" }).eq("id", photo.id);
  };

  const active = photos.filter((p) => p.style_status === "queued" || p.style_status === "running");
  await Promise.all(
    active.map(async (photo) => {
      if (!photo.style_request_id) return markFailed(photo);

      let check: RestyleCheck;
      try {
        check = await checkRestyle(photo.style_request_id);
      } catch {
        return; // Network hiccup: check again on the next poll.
      }

      if (check.state === "pending") {
        if (check.running && photo.style_status !== "running") {
          photo.style_status = "running";
          await supabase.from("project_images").update({ style_status: "running" }).eq("id", photo.id);
        }
        return;
      }
      if (check.state === "failed") return markFailed(photo);

      try {
        const res = await fetch(check.url);
        if (!res.ok) throw new Error(`Download failed (${res.status})`);
        const contentType = check.contentType ?? res.headers.get("content-type") ?? "image/jpeg";
        const ext = contentType.includes("png") ? "png" : contentType.includes("webp") ? "webp" : "jpg";
        const path = `${user.id}/${id}/styled-${photo.id}.${ext}`;
        const { error } = await supabase.storage
          .from(BUCKET)
          .upload(path, await res.arrayBuffer(), { contentType, upsert: true });
        if (error) throw new Error(error.message);
        await supabase
          .from("project_images")
          .update({ styled_path: path, style_status: "done" })
          .eq("id", photo.id);
        photo.style_status = "done";
      } catch {
        await markFailed(photo);
      }
    }),
  );

  const count = (status: string) => photos.filter((p) => p.style_status === status).length;
  const done = count("done");
  const failed = count("failed");
  const pending = count("queued") + count("running");

  if (pending === 0 && movie.status === "styling") {
    await supabase
      .from("projects")
      .update({
        status: "planned",
        error: failed > 0 ? `${failed} photo${failed === 1 ? "" : "s"} couldn't be redrawn. Select Redraw to try again.` : null,
      })
      .eq("id", id);
  }

  return NextResponse.json({ total: photos.length, done, failed, pending });
}
