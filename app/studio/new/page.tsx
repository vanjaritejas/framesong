import NewMovieForm from "@/components/NewMovieForm";

export const metadata = { title: "New movie – FrameSong" };

export default function NewMoviePage() {
  return (
    <>
      <div className="page-head">
        <div>
          <h1>New movie</h1>
          <p>Add your photos, choose a look and a song, then create the movie.</p>
        </div>
      </div>
      <NewMovieForm />
    </>
  );
}
