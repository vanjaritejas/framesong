import { fal } from "@fal-ai/client";
import { requireEnv } from "@/lib/server-env";
import { signedUrlMap } from "@/lib/storage";
import { needsRestyle, type AspectId, type StyleId } from "@/lib/constants";
import type { createClient } from "@/lib/supabase/server";

type ServerSupabase = Awaited<ReturnType<typeof createClient>>;

// Google's Nano Banana 2 image editor, run on fal.ai.
// Typed as a plain string so the input below isn't locked to one model's types.
export const RESTYLE_MODEL: string = "fal-ai/nano-banana-2/edit";

// "1K" is cheapest and fine for testing. "2K" gives sharper frames for the final 4K movie.
export const RESTYLE_RESOLUTION = "1K";

const LOOK_PROMPT: Partial<Record<StyleId, string>> = {
  animated_3d:
    "Redraw this photo as a frame from a 3D animated feature film: stylized characters with expressive faces, soft global lighting, rich saturated colors, and detailed textures.",
  cartoon:
    "Redraw this photo as a hand-drawn 2D cartoon: bold clean outlines, flat cheerful colors, and simple shading.",
};

export { needsRestyle };

function restylePrompt(style: StyleId, aspect: AspectId) {
  return [
    LOOK_PROMPT[style],
    "Keep the same people, animals, objects, poses, and setting, and keep everyone recognizable.",
    `Fill the whole ${aspect} frame, extending the background naturally if needed.`,
    "Do not add text, logos, or new characters.",
  ].join(" ");
}

let configured = false;
function falClient() {
  if (!configured) {
    fal.config({ credentials: requireEnv("FAL_KEY") });
    configured = true;
  }
  return fal;
}

// Starts one redraw job per photo. Results are collected later by checkRestyle.
export async function submitRestyles(
  supabase: ServerSupabase,
  movie: { style: StyleId; aspect: AspectId },
  photos: { id: string; storage_path: string }[],
) {
  const client = falClient();
  const urls = await signedUrlMap(
    supabase,
    photos.map((p) => p.storage_path),
    3600,
  );
  let firstError: string | null = null;

  const results = await Promise.all(
    photos.map(async (photo) => {
      const url = urls.get(photo.storage_path);
      try {
        if (!url) throw new Error("The photo link couldn't be created.");
        const { request_id } = await client.queue.submit(RESTYLE_MODEL, {
          input: {
            prompt: restylePrompt(movie.style, movie.aspect),
            image_urls: [url],
            aspect_ratio: movie.aspect,
            resolution: RESTYLE_RESOLUTION,
            output_format: "jpeg",
            num_images: 1,
          },
        });
        await supabase
          .from("project_images")
          .update({ style_status: "queued", style_request_id: request_id })
          .eq("id", photo.id);
        return true;
      } catch (err) {
        firstError ??= err instanceof Error ? err.message : String(err);
        await supabase
          .from("project_images")
          .update({ style_status: "failed", style_request_id: null })
          .eq("id", photo.id);
        return false;
      }
    }),
  );

  return { submitted: results.filter(Boolean).length, firstError: firstError as string | null };
}

export type RestyleCheck =
  | { state: "pending"; running: boolean }
  | { state: "failed" }
  | { state: "done"; url: string; contentType: string | null };

export async function checkRestyle(requestId: string): Promise<RestyleCheck> {
  const client = falClient();
  const status = await client.queue.status(RESTYLE_MODEL, { requestId });
  if (status.status !== "COMPLETED") {
    return { state: "pending", running: status.status === "IN_PROGRESS" };
  }
  try {
    const result = await client.queue.result(RESTYLE_MODEL, { requestId });
    const data = result.data as { images?: { url?: string; content_type?: string }[] };
    const image = data.images?.[0];
    if (!image?.url) return { state: "failed" };
    return { state: "done", url: image.url, contentType: image.content_type ?? null };
  } catch {
    return { state: "failed" };
  }
}
