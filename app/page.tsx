import Link from "next/link";
import SiteHeader from "@/components/SiteHeader";
import Scene from "@/components/Scene";
import { STYLES, STYLE_NAME, type StyleId } from "@/lib/constants";
import { createClient } from "@/lib/supabase/server";

const STRIP: StyleId[] = [
  "real_nature",
  "animated_3d",
  "cartoon",
  "real_nature",
  "cartoon",
  "animated_3d",
  "real_nature",
  "animated_3d",
];

export default async function HomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const startHref = user ? "/studio/new" : "/login?next=/studio/new";

  return (
    <>
      <SiteHeader email={user?.email} />
      <main>
        <section className="hero wrap">
          <h1>Your photos, turned into a short film with its own song.</h1>
          <p className="lede">
            Add photos from a trip, a birthday, or a walk outside. Pick how it
            should look. FrameSong animates every shot, makes a song for your
            story, and cuts the film to the beat.
          </p>
          <div className="actions">
            <Link href={startHref} className="btn btn-primary">
              Make a movie
            </Link>
            {user && (
              <Link href="/studio" className="btn btn-quiet">
                Your movies
              </Link>
            )}
          </div>
        </section>

        <div
          className="filmstrip"
          role="img"
          aria-label="A film strip showing the same landscape in three looks: real nature, 3D animated, and cartoon."
        >
          <div className="film-track">
            {[0, 1].map((copy) =>
              STRIP.map((look, i) => (
                <figure className="film-frame" key={`${copy}-${i}`} aria-hidden="true">
                  <Scene look={look} />
                  <figcaption>
                    <span>{STYLE_NAME[look]}</span>
                    <span>{i + 1}</span>
                  </figcaption>
                </figure>
              )),
            )}
          </div>
        </div>

        <section className="section wrap" aria-labelledby="how">
          <h2 id="how">How it works</h2>
          <ol className="steps">
            <li>
              <span className="step-n" aria-hidden="true">1</span>
              <h3>Add your photos</h3>
              <p>Upload 3 to 20 photos and put them in the order you want them to play.</p>
            </li>
            <li>
              <span className="step-n" aria-hidden="true">2</span>
              <h3>Pick a look and a song</h3>
              <p>
                Keep it photographic, or turn it into a 3D animated or cartoon film.
                Choose a mood for a new song, or bring your own.
              </p>
            </li>
            <li>
              <span className="step-n" aria-hidden="true">3</span>
              <h3>Watch your film</h3>
              <p>Watch a preview first, then render it in 4K when you’re happy with it.</p>
            </li>
          </ol>
        </section>

        <section className="section wrap" aria-labelledby="looks">
          <h2 id="looks">Three looks for the same photos</h2>
          <div className="looks">
            {STYLES.map((s) => (
              <div className="look" key={s.id}>
                <Scene look={s.id} />
                <h3>{s.name}</h3>
                <p>{s.description}</p>
              </div>
            ))}
          </div>
        </section>
      </main>
      <footer className="site-footer">
        <div className="wrap">FrameSong</div>
      </footer>
    </>
  );
}
