import { useEffect, useRef, useState } from "react";
import type { ArtKind } from "../../data/types";
import { SIZES, srcSet, thumb, type PhotoSize } from "../../lib/images";
import { Art } from "./Art";

/**
 * Operator photo. Shows a quiet shimmer until the image has actually loaded, then fades it in.
 * Images go through a resizing proxy sized for where they sit, falling back to the original if the proxy fails.
 * The scene illustration only appears when there is no photo or it fails to load.
 * Video covers load nothing until the card is on screen, then play muted on loop.
 * The hero and the first handful of cards mounted on a page load eagerly with a high fetch priority, so the first
 * rail paints before the browser gets round to the dozens of lazy cards further down; everything else stays lazy.
 */
const EAGER_CARDS = 8;
let eagerLeft = EAGER_CARDS;

export function Photo({ src, video, kind, id, alt, size = "card" }: { src?: string; video?: string; kind: ArtKind; id: string; alt: string; size?: PhotoSize }) {
  const [state, setState] = useState<"loading" | "ok" | "broken">("loading");
  const [clipOk, setClipOk] = useState(true);
  const [proxied, setProxied] = useState(true);
  const [seen, setSeen] = useState(false);
  const [priority] = useState(() => size === "hero" || size === "full" || (size === "card" && eagerLeft-- > 0));
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
          <img className="photo" src={thumb(src, size)} srcSet={srcSet(src, size)} sizes={SIZES[size]} alt={alt} loading="lazy" decoding="async" referrerPolicy="no-referrer" />
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
        srcSet={proxied ? srcSet(still, size) : undefined}
        sizes={proxied ? SIZES[size] : undefined}
        alt={alt}
        loading={priority ? "eager" : "lazy"}
        fetchPriority={priority ? "high" : "auto"}
        decoding="async"
        referrerPolicy="no-referrer"
        onLoad={(e) => setState((e.currentTarget as HTMLImageElement).naturalWidth >= 120 ? "ok" : "broken")}
        onError={() => {
          // The proxy can refuse a URL or rate-limit us. Fall back to the operator's original rather than a blank card;
          // a slow photo beats no photo, and the browser only pulls it for cards on screen.
          if (proxied && url !== still) setProxied(false);
          else if (still !== src) setClipOk(false);
          else setState("broken");
        }}
      />
    </span>
  );
}
