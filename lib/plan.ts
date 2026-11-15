// The director's plan, saved on each movie. Safe to import anywhere.
export type Shot = {
  image_id: string;
  scene: string;
  motion: string;
  seconds: number;
};

export type SongPlan = {
  title: string;
  style: string;
  bpm: number;
  lyrics: string;
};

export type DirectorPlan = {
  title: string;
  logline: string;
  shots: Shot[];
  song: SongPlan;
  total_seconds: number;
  reordered: boolean;
  model: string;
  created_at: string;
};

export function isPlan(value: unknown): value is DirectorPlan {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as DirectorPlan).shots) &&
    typeof (value as DirectorPlan).song === "object"
  );
}
