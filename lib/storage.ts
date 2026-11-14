import type { SupabaseClient } from "@supabase/supabase-js";

export const BUCKET = "uploads";

type WithStorage = Pick<SupabaseClient, "storage">;

// Files are private, so pages show them through short-lived signed links.
export async function signedUrlMap(
  supabase: WithStorage,
  paths: string[],
  expiresInSeconds = 3600,
) {
  const map = new Map<string, string>();
  const unique = Array.from(new Set(paths.filter(Boolean)));
  if (unique.length === 0) return map;

  const { data } = await supabase.storage
    .from(BUCKET)
    .createSignedUrls(unique, expiresInSeconds);

  for (const item of data ?? []) {
    if (item.path && item.signedUrl) map.set(item.path, item.signedUrl);
  }
  return map;
}
