"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { BUCKET } from "@/lib/storage";

export async function deleteProject(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !id) redirect("/login");

  // Remove every file in this movie's folder (photos, song, and later clips).
  const folder = `${user.id}/${id}`;
  const { data: files } = await supabase.storage.from(BUCKET).list(folder, { limit: 1000 });
  const paths = (files ?? []).map((f) => `${folder}/${f.name}`);
  if (paths.length > 0) await supabase.storage.from(BUCKET).remove(paths);

  // Row level security makes sure people can only delete their own movies.
  await supabase.from("projects").delete().eq("id", id);

  revalidatePath("/studio");
  redirect("/studio");
}
