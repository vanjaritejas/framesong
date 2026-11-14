import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { signedUrlMap } from "@/lib/storage";
import { STATUS_LABELS, STYLE_NAME, ratioCss, type StyleId } from "@/lib/constants";

export const metadata = { title: "Your movies – FrameSong" };

type MovieRow = {
  id: string;
  title: string;
  style: StyleId;
  aspect_ratio: string;
  status: string;
  created_at: string;
  project_images: { storage_path: string; position: number }[];
};

export default async function StudioPage() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("projects")
    .select("id, title, style, aspect_ratio, status, created_at, project_images(storage_path, position)")
    .order("created_at", { ascending: false });

  if (error) {
    return (
      <div className="notice error" role="alert">
        <p>
          <strong>Your movies couldn’t load.</strong> {error.message}
        </p>
        <p>
          On a new setup, this usually means the database tables don’t exist yet. Run
          supabase/schema.sql in the Supabase SQL Editor, then reload this page.
        </p>
      </div>
    );
  }

  const movies = (data ?? []) as unknown as MovieRow[];
  const coverOf = (m: MovieRow) =>
    [...m.project_images].sort((a, b) => a.position - b.position)[0]?.storage_path;
  const urls = await signedUrlMap(
    supabase,
    movies.map(coverOf).filter((p): p is string => Boolean(p)),
  );

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Your movies</h1>
          <p>Every movie you start is saved here.</p>
        </div>
        {movies.length > 0 && (
          <Link href="/studio/new" className="btn btn-primary">
            New movie
          </Link>
        )}
      </div>

      {movies.length === 0 ? (
        <div className="empty">
          <h2>No movies yet</h2>
          <p>
            Start with a few photos from a trip, a birthday, or a walk outside. You’ll
            pick the look and the song next.
          </p>
          <Link href="/studio/new" className="btn btn-primary">
            Make your first movie
          </Link>
        </div>
      ) : (
        <ul className="project-grid">
          {movies.map((m) => {
            const cover = coverOf(m);
            const src = cover ? urls.get(cover) : undefined;
            return (
              <li key={m.id}>
                <Link href={`/studio/${m.id}`} className="project-card">
                  <div className="cover" style={{ aspectRatio: ratioCss(m.aspect_ratio) }}>
                    {src && <img src={src} alt="" />}
                  </div>
                  <h3>{m.title}</h3>
                  <div className="card-meta">
                    <span>
                      {m.project_images.length} photos, {STYLE_NAME[m.style] ?? m.style}
                    </span>
                    <span className="badge" data-status={m.status}>
                      {STATUS_LABELS[m.status] ?? m.status}
                    </span>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
