import { useState } from "react";
import type { ArtKind } from "../../data/types";
import { Art } from "./Art";

/**
 * Operator photo with the scene illustration as fallback. Photos are linked from the operator's own site,
 * so a broken or blocked image quietly falls back instead of leaving a hole.
 */
export function Photo({ src, kind, id, alt }: { src?: string; kind: ArtKind; id: string; alt: string }) {
  const [broken, setBroken] = useState(false);
  if (!src || broken) return <Art kind={kind} id={id} />;
  return <img className="photo" src={src} alt={alt} loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(true)} />;
}
