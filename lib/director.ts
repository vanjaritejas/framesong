import Anthropic from "@anthropic-ai/sdk";
import sharp from "sharp";
import { requireEnv } from "@/lib/server-env";
import { ASPECT_NAME, STYLE_NAME, type AspectId, type StyleId } from "@/lib/constants";
import type { DirectorPlan, Shot } from "@/lib/plan";

// Sonnet balances quality and cost well for this job.
// Switch to "claude-opus-5-5" for richer plans at a higher price.
export const DIRECTOR_MODEL = "claude-sonnet-5-5";

export type PlanInput = {
  photos: { id: string; data: Buffer }[];
  style: StyleId;
  aspect: AspectId;
  songMode: "ai" | "upload";
  mood: string | null;
  notes: string | null;
  reorder: boolean;
};

const LOOK_DIRECTION: Record<StyleId, string> = {
  real_nature:
    "Photographic and realistic. Motion should feel like real footage: gentle natural movement and smooth cinematic camera moves.",
  animated_3d:
    "Each photo will be redrawn as a scene from a 3D animated feature film. Motion can be a little playful and expressive, like an animated movie.",
  cartoon:
    "Each photo will be redrawn as a hand-drawn 2D cartoon. Motion should be simple and lively, like classic 2D animation.",
};

const DEFAULT_MOTION: Record<StyleId, string> = {
  real_nature: "Slow cinematic push-in while light and leaves move gently in the breeze.",
  animated_3d: "Gentle camera glide as the scene comes to life with soft, playful movement.",
  cartoon: "Simple bouncy movement with a slow pan across the scene.",
};

const SYSTEM = `You are the director of FrameSong, an app that turns a person's photos into a short film set to an original song.
You plan the film from the photos: the order they play in, how each shot moves, and the song.
Describe only what is actually visible in each photo. Never invent people, animals, or objects that are not in a photo.
Write original song lyrics only. Never reuse or imitate existing song lyrics, and never name real artists or bands.`;

const PLAN_TOOL = {
  name: "save_movie_plan",
  description: "Save the finished plan for the short film.",
  input_schema: {
    type: "object" as const,
    properties: {
      title: { type: "string", description: "A short film title, at most 6 words." },
      logline: { type: "string", description: "One sentence about the story the film tells." },
      order: {
        type: "array",
        items: { type: "integer" },
        description: "Photo numbers in play order. Every photo number exactly once.",
      },
      shots: {
        type: "array",
        description: "One entry per photo.",
        items: {
          type: "object",
          properties: {
            photo: { type: "integer", description: "The photo number." },
            scene: { type: "string", description: "One short sentence about what is in the photo." },
            motion: {
              type: "string",
              description:
                "Prompt for an image-to-video model, under 40 words: camera movement plus natural motion of things already in the photo.",
            },
            seconds: { type: "integer", description: "How long this shot plays, 3 to 8." },
          },
          required: ["photo", "scene", "motion", "seconds"],
        },
      },
      song: {
        type: "object",
        properties: {
          title: { type: "string" },
          style: {
            type: "string",
            description: "Genre, instruments, tempo feel, and vocal type, under 120 characters. No artist names.",
          },
          bpm: { type: "integer", description: "Tempo, 60 to 160." },
          lyrics: {
            type: "string",
            description: "Original lyrics with [Verse] and [Chorus] labels, or an empty string when not needed.",
          },
        },
        required: ["title", "style", "bpm", "lyrics"],
      },
    },
    required: ["title", "logline", "order", "shots", "song"],
  },
};

// Claude doesn't need full-size photos to plan a film. Smaller images are faster and cheaper.
async function toJpegBase64(data: Buffer) {
  const out = await sharp(data)
    .rotate()
    .resize({ width: 1024, height: 1024, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 80 })
    .toBuffer();
  return out.toString("base64");
}

function instructions(input: PlanInput) {
  const n = input.photos.length;
  const target = Math.min(90, Math.max(15, n * 5));
  const lines = [
    `Plan a short film from these ${n} photos.`,
    "",
    `Look: ${STYLE_NAME[input.style]}. ${LOOK_DIRECTION[input.style]}`,
    `Format: ${input.aspect} (${ASPECT_NAME[input.aspect]}).`,
  ];

  if (input.songMode === "ai") {
    lines.push(`Song mood: ${input.mood ?? "Happy and bright"}.`);
    if (input.notes) lines.push(`The song should mention: ${input.notes}`);
  } else {
    lines.push(
      "The person is using their own song. Set song.lyrics to an empty string, and use song.style to describe the pacing the film should have.",
    );
  }

  lines.push(
    "",
    "Guidelines:",
    input.reorder
      ? "- order: arrange the photos so they tell a story, for example by time of day, by a journey, or building toward the most striking photo. Use every photo number exactly once."
      : `- order: keep the photos in the given order: ${Array.from({ length: n }, (_, i) => i + 1).join(", ")}.`,
    "- For each photo, write scene (one short sentence about what is in it) and motion (camera movement plus natural motion of what is already there, such as hair in the wind, waves, steam, or people smiling or walking).",
    `- seconds: 3 to 8 per shot. Give the strongest photos more time. Aim for about ${target} seconds in total.`,
    "- song: an original song for this film. Lyrics should be short enough to sing in the film's length, roughly 2 lines per 10 seconds, with [Verse] and [Chorus] labels.",
    "- title: at most 6 words. logline: one sentence.",
    "",
    "Save the plan with the save_movie_plan tool.",
  );
  return lines.join("\n");
}

function text(value: unknown, fallback: string, max: number) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : fallback;
}

function whole(value: unknown, fallback: number, min: number, max: number) {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
}

// Claude's answer is checked and repaired so a slightly-off reply never breaks the movie.
function normalize(raw: unknown, input: PlanInput): DirectorPlan {
  const n = input.photos.length;
  const obj = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;

  const proposed = Array.isArray(obj.order) ? obj.order.map((x) => Number(x)) : [];
  const validOrder =
    proposed.length === n &&
    new Set(proposed).size === n &&
    proposed.every((x) => Number.isInteger(x) && x >= 1 && x <= n);
  const useClaudeOrder = input.reorder && validOrder;
  const order = useClaudeOrder ? proposed : Array.from({ length: n }, (_, i) => i + 1);

  const byPhoto = new Map<number, Record<string, unknown>>();
  for (const item of Array.isArray(obj.shots) ? obj.shots : []) {
    if (typeof item === "object" && item !== null) {
      const rec = item as Record<string, unknown>;
      const key = Number(rec.photo);
      if (Number.isInteger(key)) byPhoto.set(key, rec);
    }
  }

  const shots: Shot[] = order.map((photoNumber) => {
    const rec = byPhoto.get(photoNumber) ?? {};
    return {
      image_id: input.photos[photoNumber - 1].id,
      scene: text(rec.scene, "", 300),
      motion: text(rec.motion, DEFAULT_MOTION[input.style], 400),
      seconds: whole(rec.seconds, 5, 3, 8),
    };
  });

  const song = (typeof obj.song === "object" && obj.song !== null ? obj.song : {}) as Record<string, unknown>;

  return {
    title: text(obj.title, "", 80),
    logline: text(obj.logline, "", 300),
    shots,
    song: {
      title: text(song.title, "Untitled song", 80),
      style: text(song.style, "", 200),
      bpm: whole(song.bpm, 100, 60, 160),
      lyrics: input.songMode === "ai" ? text(song.lyrics, "", 3000) : "",
    },
    total_seconds: shots.reduce((sum, s) => sum + s.seconds, 0),
    reordered: useClaudeOrder,
    model: DIRECTOR_MODEL,
    created_at: new Date().toISOString(),
  };
}

export async function planMovie(input: PlanInput): Promise<DirectorPlan> {
  const client = new Anthropic({ apiKey: requireEnv("ANTHROPIC_API_KEY") });
  const images = await Promise.all(input.photos.map((p) => toJpegBase64(p.data)));

  // Images go first, each labeled with its number, then the instructions.
  const imageBlocks = images.flatMap((data, i) => [
    { type: "text" as const, text: `Photo ${i + 1}:` },
    {
      type: "image" as const,
      source: { type: "base64" as const, media_type: "image/jpeg" as const, data },
    },
  ]);

  const response = await client.messages.create({
    model: DIRECTOR_MODEL,
    max_tokens: 16000,
    system: SYSTEM,
    tools: [PLAN_TOOL],
        tool_choice: { type: "auto" },
    messages: [
      {
        role: "user",
        content: [...imageBlocks, { type: "text" as const, text: instructions(input) }],
      },
    ],
  });

  const block = response.content.find((b) => b.type === "tool_use");
  if (!block || block.type !== "tool_use") {
    throw new Error("Claude didn't return a plan. Try again.");
  }
  return normalize(block.input, input);
}
