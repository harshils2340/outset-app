import { sceneInner } from "../../data/art";

export function Art({ kind, id }: { kind: string; id: string }) {
  const inner = sceneInner(kind, id);
  return (
    <svg
      className="art"
      viewBox="0 0 300 200"
      preserveAspectRatio="xMidYMid slice"
      style={{ display: "block", width: "100%", height: "100%" }}
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: inner }}
    />
  );
}
