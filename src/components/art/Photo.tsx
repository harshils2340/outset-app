import { useState } from "react";
import type { ArtKind } from "../../data/types";
import { Art } from "./Art";

/**
 * Operator photo. Shows a quiet shimmer until the image has actually loaded, then fades it in.
 * The scene illustration only appears when there is no photo or it fails to load.
 */
export function Photo({ src, kind, id, alt }: { src?: string; kind: ArtKind; id: string; alt: string }) {
  const [state, setState] = useState<"loading" | "ok" | "broken">("loading");
  if (!src || state === "broken") return <Art kind={kind} id={id} />;
  return (
    <span className={"photowrap" + (state === "ok" ? " ready" : "")}>
      <img
        className="photo"
        src={src}
        alt={alt}
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
        onLoad={(e) => setState((e.currentTarget as HTMLImageElement).naturalWidth >= 120 ? "ok" : "broken")}
        onError={() => setState("broken")}
      />
    </span>
  );
}
