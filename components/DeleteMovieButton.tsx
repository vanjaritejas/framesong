"use client";

import { useFormStatus } from "react-dom";

export default function DeleteMovieButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      className="btn btn-danger"
      disabled={pending}
      onClick={(e) => {
        if (!window.confirm("Delete this movie and all of its photos? This can’t be undone.")) {
          e.preventDefault();
        }
      }}
    >
      {pending ? "Deleting…" : "Delete movie"}
    </button>
  );
}
