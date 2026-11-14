import type { StyleId } from "@/lib/constants";

const LOOK_CLASS: Record<StyleId, string> = {
  real_nature: "scene--real",
  animated_3d: "scene--3d",
  cartoon: "scene--cartoon",
};

// A small drawn landscape showing what each look feels like.
export default function Scene({ look }: { look: StyleId }) {
  return <div className={`scene ${LOOK_CLASS[look]}`} aria-hidden="true" />;
}
