import { useState } from "react";
import type { ArtKind } from "../../data/types";
import { Art } from "./Art";

/**
 * Operator photo. Shows a quiet shimmer until the image has actually loaded, then fades it in.
 * The scene illustration only appears when there is no photo or it fails to load.
 */
export function Photo({ src, video, kind, id, alt }: { src?: string; video?: string; kind: ArtKind; id: string; alt: string }) {
  const [state, setState] = useState<"loading" | "ok" | "broken">("loading");
  const [clipOk, setClipOk] = useState(true);
  if (video && clipOk && /\.(mp4|webm|m4v|mov)(\?|$)/i.test(video)) {
    // A moving cover. Muted, looping, no controls: it reads as a live thumbnail, not a player.
    return (
      <span className="photowrap ready">
        <video className="photo" src={video} poster={src} muted loop autoPlay playsInline preload="metadata" aria-label={alt} onError={() => setClipOk(false)} />
      </span>
    );
  }
  const still = video && clipOk && /\.gif(\?|$)/i.test(video) ? video : src;
  if (!still || state === "broken") return <Art kind={kind} id={id} />;
  return (
    <span className={"photowrap" + (state === "ok" ? " ready" : "")}>
      <img
        className="photo"
        src={still}
        alt={alt}
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
        onLoad={(e) => setState((e.currentTarget as HTMLImageElement).naturalWidth >= 120 ? "ok" : "broken")}
        onError={() => {
          if (still !== src) setClipOk(false);
          else setState("broken");
        }}
      />
    </span>
  );
}
