export const STYLES = [
  {
    id: "real_nature",
    name: "Real nature",
    description:
      "Keeps your photos photographic. Leaves move, water flows, and the camera drifts slowly through each scene.",
  },
  {
    id: "animated_3d",
    name: "3D animated",
    description:
      "Redraws each photo as a scene from a 3D animated film, then brings it to life.",
  },
  {
    id: "cartoon",
    name: "Cartoon",
    description:
      "Redraws each photo as a hand-drawn 2D cartoon with bold lines and flat color.",
  },
] as const;

export type StyleId = (typeof STYLES)[number]["id"];

// Cartoon and 3D movies redraw every photo before animating; real nature keeps them.
export function needsRestyle(style: StyleId) {
  return style === "animated_3d" || style === "cartoon";
}

export const STYLE_NAME = Object.fromEntries(
  STYLES.map((s) => [s.id, s.name]),
) as Record<StyleId, string>;

export const ASPECTS = [
  { id: "16:9", name: "Widescreen", hint: "YouTube and TV" },
  { id: "9:16", name: "Vertical", hint: "Reels, TikTok, Shorts" },
  { id: "1:1", name: "Square", hint: "Feed posts" },
] as const;

export type AspectId = (typeof ASPECTS)[number]["id"];

export const ASPECT_NAME = Object.fromEntries(
  ASPECTS.map((a) => [a.id, a.name]),
) as Record<AspectId, string>;

export const MOODS: string[] = [
  "Happy and bright",
  "Calm and peaceful",
  "Epic and cinematic",
  "Romantic",
  "Nostalgic",
  "Playful",
  "Adventurous",
];

export const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  directing: "Planning",
  styling: "Redrawing photos",
  planned: "Plan ready",
  generating: "Animating",
  animated: "Clips ready",
  editing: "Editing to the song",
  preview_ready: "Preview ready",
  rendering_4k: "Rendering 4K",
  done: "Done",
  failed: "Needs attention",
};

export const PHOTO_LIMITS = {
  min: 3,
  max: 20,
  maxMB: 15,
  types: ["image/jpeg", "image/png", "image/webp"] as string[],
};

export const SONG_LIMITS = {
  maxMB: 25,
  types: [
    "audio/mpeg",
    "audio/mp3",
    "audio/mp4",
    "audio/x-m4a",
    "audio/aac",
    "audio/wav",
    "audio/x-wav",
  ] as string[],
};

export function ratioCss(aspect: string) {
  return aspect.replace(":", " / ");
}
