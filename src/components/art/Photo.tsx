import { useEffect, useRef, useState } from "react";
import type { ArtKind } from "../../data/types";
import { thumb, type PhotoSize } from "../../lib/images";
import { Art } from "./Art";

/**
 * Operator photo. Shows a quiet shimmer until the image has actually loaded, then fades it in.
 * Images go through a resizing proxy sized for where they sit, falling back to the original if the proxy fails.
 * The scene illustration only appears when there is no photo or it fails to load.
 * Video covers load nothing until the card is on screen, then play muted on loop.
 */
export function Photo({ src, video, kind, id, alt, size = "card" }: { src?: string; video?: string; kind: ArtKind; id: string; alt: string; size?: PhotoSize }) {
  const [state, setState] = useState<"loading" | "ok" | "broken">("loading");
  const [clipOk, setClipOk] = useState(true);
  const [proxied, setProxied] = useState(true);
  const [seen, setSeen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  const isClip = !!video && clipOk && /\.(mp4|webm|m4v|mov)(\?|$)/i.test(video);
  useEffect(() => {
    if (!isClip || seen || !ref.current || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        setSeen(true);
        io.disconnect();
      }
    }, { rootMargin: "200px" });
    io.observe(ref.current);
    return () => io.disconnect();
  }, [isClip, seen]);

  if (isClip) {
    // A moving cover. Muted, looping, no controls: it reads as a live thumbnail, not a player.
    return (
      <span className="photowrap ready" ref={ref}>
        {seen ? (
          <video className="photo" src={video} poster={thumb(src, size)} muted loop autoPlay playsInline preload="metadata" aria-label={alt} onError={() => setClipOk(false)} />
        ) : src ? (
          <img className="photo" src={thumb(src, size)} alt={alt} loading="lazy" decoding="async" referrerPolicy="no-referrer" />
        ) : (
          <Art kind={kind} id={id} />
        )}
      </span>
    );
  }
  const still = video && clipOk && /\.gif(\?|$)/i.test(video) ? video : src;
  if (!still || state === "broken") return <Art kind={kind} id={id} />;
  const url = proxied ? thumb(still, size) : still;
  return (
    <span className={"photowrap" + (state === "ok" ? " ready" : "")}>
      <img
        className="photo"
        src={url}
        alt={alt}
        loading={size === "hero" ? "eager" : "lazy"}
        decoding="async"
        referrerPolicy="no-referrer"
        onLoad={(e) => setState((e.currentTarget as HTMLImageElement).naturalWidth >= 120 ? "ok" : "broken")}
        onError={() => {
          if (proxied && url !== still) setProxied(false);
          else if (still !== src) setClipOk(false);
          else setState("broken");
        }}
      />
    </span>
  );
}
