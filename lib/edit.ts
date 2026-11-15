import { fal } from "@fal-ai/client";
import { requireEnv } from "@/lib/server-env";
import { falErrorMessage } from "@/lib/errors";
import { SONG_EXTRA_SECONDS } from "@/lib/timeline";
import type { SongPlan } from "@/lib/plan";

// MiniMax Music 3 on fal.ai: sings your lyrics over a full arrangement.
// If you switch models, update SONG_PRICE_PER_SECOND in lib/timeline.ts.
// Typed as a plain string so the inputs below aren't locked to one model's types.
// (The edit itself runs on your own server: see lib/render.ts.)
export const SONG_MODEL: string = "minimax/music-3";

let configured = false;
function falClient() {
  if (!configured) {
    fal.config({ credentials: requireEnv("FAL_KEY") });
    configured = true;
  }
  return fal;
}

// ── The song ───────────────────────────────────

const SECTION_TAGS = [
  "intro",
  "verse",
  "pre-chorus",
  "chorus",
  "post-chorus",
  "bridge",
  "instrumental",
  "solo",
  "outro",
];

function sectionTag(label: string) {
  const name = label
    .toLowerCase()
    .replace(/[0-9]/g, "")
    .replace(/\s+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (name === "prechorus") return "pre-chorus";
  if (name === "hook" || name === "refrain") return "chorus";
  return SECTION_TAGS.includes(name) ? name : "verse";
}

// MiniMax needs each [section] tag on its own line, like [verse] or [chorus].
export function songLyrics(lyrics: string) {
  const out: string[] = [];
  for (const raw of lyrics.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const tagged = line.match(/^\[([^\]]+)\]\s*(.*)$/);
    if (tagged) {
      out.push(`[${sectionTag(tagged[1])}]`);
      if (tagged[2]) out.push(tagged[2]);
    } else {
      out.push(line);
    }
  }
  const text = out.join("\n").slice(0, 3000);
  return text.trim() ? text : "[instrumental]";
}

export function songPrompt(song: SongPlan, mood: string | null) {
  return [
    song.style ? `Genre: ${song.style}.` : "Genre: modern pop.",
    `BPM: ${song.bpm}.`,
    `Mood: ${mood ?? "happy and bright"}.`,
    "Vocals: clear lead vocal, every word easy to understand.",
    "Arrangement: a steady, strong beat from the first second, and a clean ending.",
  ].join(" ");
}

export async function submitSong(song: SongPlan, mood: string | null, movieSeconds: number) {
  const client = falClient();
  const duration = Math.min(300, Math.max(10, Math.ceil(movieSeconds + SONG_EXTRA_SECONDS)));
  const { request_id } = await client.queue.submit(SONG_MODEL, {
    input: {
      prompt: songPrompt(song, mood),
      lyrics: songLyrics(song.lyrics),
      duration,
    },
  });
  return request_id;
}

export type SongCheck =
  | { state: "pending"; running: boolean }
  | { state: "failed"; reason: string }
  | { state: "done"; url: string; seconds: number | null; contentType: string | null };

export async function checkSong(requestId: string): Promise<SongCheck> {
  const client = falClient();
  const status = await client.queue.status(SONG_MODEL, { requestId });
  if (status.status !== "COMPLETED") return { state: "pending", running: status.status === "IN_PROGRESS" };
  try {
    const result = await client.queue.result(SONG_MODEL, { requestId });
    const data = result.data as { audio?: { url?: string; content_type?: string }; duration?: number };
    if (!data.audio?.url) return { state: "failed", reason: "The music model didn't return a song." };
    return {
      state: "done",
      url: data.audio.url,
      seconds: typeof data.duration === "number" ? data.duration : null,
      contentType: data.audio.content_type ?? null,
    };
  } catch (err) {
    return { state: "failed", reason: falErrorMessage(err, "The music model couldn't make the song.") };
  }
}
