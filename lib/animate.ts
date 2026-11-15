import { fal } from "@fal-ai/client";
import sharp from "sharp";
import { requireEnv } from "@/lib/server-env";
import { falErrorMessage } from "@/lib/errors";
import { BUCKET, signedUrlMap } from "@/lib/storage";
import { clipSecondsFor } from "@/lib/video";
import type { AspectId, StyleId } from "@/lib/constants";
import type { createClient } from "@/lib/supabase/server";

type ServerSupabase = Awaited<ReturnType<typeof createClient>>;

// Google's Veo 3.1 Lite image-to-video model, run on fal.ai.
// To try another model, paste its model ID from fal.ai here (for example
// "fal-ai/veo3.1/image-to-video" for full Veo 3.1), check that it takes the same
// inputs as submitClips below, and update VIDEO_PRICE_PER_SECOND in lib/video.ts.
// Typed as a plain string so the input below isn't locked to one model's types.
export const VIDEO_MODEL: string = "fal-ai/veo3.1/lite/image-to-video";

// "720p" is cheapest and fine for testing. Day 5 upscales the finished movie to 4K.
export const VIDEO_RESOLUTION = "720p";

// Veo makes 16:9 and 9:16 clips. Square movies get 16:9 clips, cropped to square in the edit.
function clipAspect(aspect: AspectId) {
  return aspect === "9:16" ? "9:16" : "16:9";
}

const LOOK_HINT: Record<StyleId, string> = {
  real_nature: "Photorealistic footage with natural light and a smooth cinematic camera.",
  animated_3d: "Keep the 3D animated film look of the image.",
  cartoon: "Keep the hand-drawn 2D cartoon look of the image.",
};

const NEGATIVE_PROMPT =
  "text, subtitles, captions, watermark, logo, distorted faces, extra people, extra limbs, flicker";

function clipPrompt(motion: string, style: StyleId) {
  const action = motion.trim() || "Slow, gentle camera push-in as the scene comes to life.";
  return `${action} ${LOOK_HINT[style]} Keep every person's face and the setting the same as in the image.`;
}

let configured = false;
function falClient() {
  if (!configured) {
    fal.config({ credentials: requireEnv("FAL_KEY") });
    configured = true;
  }
  return fal;
}

// Veo accepts input images up to 8 MB. Bigger originals get a smaller copy for animating.
const MAX_INPUT_BYTES = 7 * 1024 * 1024;

export type ClipJob = {
  id: string; // the photo's row id
  storage_path: string; // the original photo
  styled_path: string | null; // the cartoon / 3D redraw, if any
  motion: string; // Claude's motion line for this shot
  seconds: number; // how long the shot plays in the plan
};

type MovieInfo = {
  id: string;
  userId: string;
  style: StyleId;
  aspect: AspectId;
  useStyled: boolean;
};

async function inputPathFor(supabase: ServerSupabase, movie: MovieInfo, job: ClipJob): Promise<string> {
  if (movie.useStyled) {
    if (!job.styled_path) throw new Error("This photo hasn't been redrawn yet.");
    return job.styled_path;
  }

  const { data, error } = await supabase.storage.from(BUCKET).download(job.storage_path);
  if (error || !data) throw new Error("The photo couldn't be read from storage.");
  if (data.size <= MAX_INPUT_BYTES) return job.storage_path;

  const smaller = await sharp(Buffer.from(await data.arrayBuffer()))
    .rotate()
    .resize({ width: 2560, height: 2560, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toBuffer();
  const path = `${movie.userId}/${movie.id}/anim-src-${job.id}.jpg`;
  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(path, smaller, { contentType: "image/jpeg", upsert: true });
  if (uploadError) throw new Error(`A smaller copy of the photo couldn't be saved: ${uploadError.message}`);
  return path;
}

// Starts one video job per shot. Finished clips are collected later by checkClip.
export async function submitClips(supabase: ServerSupabase, movie: MovieInfo, jobs: ClipJob[]) {
  const client = falClient();
  let firstError: string | null = null;

  // Prepare the input images one at a time, which keeps memory low for big photos.
  const prepared: { job: ClipJob; path: string | null; problem: string | null }[] = [];
  for (const job of jobs) {
    try {
      prepared.push({ job, path: await inputPathFor(supabase, movie, job), problem: null });
    } catch (err) {
      prepared.push({ job, path: null, problem: err instanceof Error ? err.message : String(err) });
    }
  }

  const urls = await signedUrlMap(
    supabase,
    prepared.flatMap((p) => (p.path ? [p.path] : [])),
    3600,
  );

  const results = await Promise.all(
    prepared.map(async ({ job, path, problem }) => {
      const seconds = clipSecondsFor(job.seconds);
      try {
        if (!path) throw new Error(problem ?? "The photo couldn't be prepared.");
        const url = urls.get(path);
        if (!url) throw new Error("The photo link couldn't be created.");
        const { request_id } = await client.queue.submit(VIDEO_MODEL, {
          input: {
            prompt: clipPrompt(job.motion, movie.style),
            image_url: url,
            aspect_ratio: clipAspect(movie.aspect),
            duration: `${seconds}s`,
            resolution: VIDEO_RESOLUTION,
            generate_audio: false,
            negative_prompt: NEGATIVE_PROMPT,
          },
        });
        await supabase
          .from("project_images")
          .update({
            clip_status: "queued",
            clip_request_id: request_id,
            clip_seconds: seconds,
            clip_path: null,
            clip_error: null,
          })
          .eq("id", job.id);
        return true;
      } catch (err) {
        const message = falErrorMessage(err, "The clip couldn't be started.");
        firstError ??= message;
        await supabase
          .from("project_images")
          .update({ clip_status: "failed", clip_request_id: null, clip_error: message.slice(0, 300) })
          .eq("id", job.id);
        return false;
      }
    }),
  );

  return { submitted: results.filter(Boolean).length, firstError: firstError as string | null };
}

export type ClipCheck =
  | { state: "pending"; running: boolean }
  | { state: "failed"; reason: string }
  | { state: "done"; url: string };

export async function checkClip(requestId: string): Promise<ClipCheck> {
  const client = falClient();
  const status = await client.queue.status(VIDEO_MODEL, { requestId });
  if (status.status !== "COMPLETED") {
    return { state: "pending", running: status.status === "IN_PROGRESS" };
  }
  try {
    const result = await client.queue.result(VIDEO_MODEL, { requestId });
    const data = result.data as { video?: { url?: string } };
    if (!data.video?.url) return { state: "failed", reason: "The video model didn't return a clip." };
    return { state: "done", url: data.video.url };
  } catch (err) {
    // Usually the model's safety filter refusing a picture, or a temporary model error.
    return { state: "failed", reason: falErrorMessage(err, "The video model couldn't make this clip.") };
  }
}
