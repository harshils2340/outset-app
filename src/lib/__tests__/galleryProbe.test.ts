/**
 * Every slide a guest can reach is one the page has checked.
 *
 * The hero probes its photos at thumbnail size before it lays out, so a dead URL or a 40 px logo never claims a
 * tile. The desktop page probed the first five, which is all the hero renders, and its own comment said the rest
 * were probed when the gallery opened. That effect was never written. The lightbox shows every photo, so on
 * 20,987 shipped listings the 52,016 slides past the fifth reached a guest unexamined, and the phone sheet, which
 * probes twelve, disagreed with the desktop about how many photos the same listing has.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";

import { photoCandidates } from "../media";

const src = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const desktop = src("../../components/web/WebListing.tsx");
const phone = src("../../components/booking/Sheets.tsx");

test("the desktop page probes past the five the hero renders", () => {
  // The hero probe stays capped: it competes with the photo the guest is waiting on.
  assert.match(desktop, /probePhotos\(candidates\.slice\(0, 5\), drop\)/, "the hero probe should still be the first five");
  // And the rest are probed once the gallery has been opened.
  assert.match(desktop, /probePhotos\(candidates\.slice\(5\), drop\)/, "the slides past the fifth are still never probed");
  assert.match(desktop, /if \(gallery != null\) setDeepProbe\(true\)/, "nothing turns the deeper probe on");
});

test("neither surface probes fewer slides than its lightbox can show", () => {
  // The phone sheet renders every entry as a slide and probes twelve, which is over the ten the sync publishes.
  const phoneCap = /probePhotos\(photoCandidates\(item\)\.slice\(0, (\d+)\), drop\)/.exec(phone);
  assert.ok(phoneCap, "the phone sheet no longer probes its photos");
  assert.ok(Number(phoneCap[1]) >= 11, "the phone sheet probes fewer than the ten photos a listing can ship");
});

test("no shipped listing carries more photos than the surfaces now probe", () => {
  // The sync caps photos at ten, plus the cover. If that ever grows past the phone's twelve, this says so
  // before a guest finds an unchecked slide.
  const dir = new URL("../../../public/o/", import.meta.url);
  let most = 0;
  let worst = "";
  for (const f of readdirSync(dir)) {
    let item: { id?: string; cover?: string; photos?: string[] };
    try {
      item = JSON.parse(readFileSync(new URL(f, dir), "utf8")) as typeof item;
    } catch {
      continue;
    }
    const n = photoCandidates({ cover: item.cover, photos: item.photos || [] } as never).length;
    if (n > most) {
      most = n;
      worst = item.id || f;
    }
  }
  assert.ok(most <= 12, worst + " ships " + most + " photos, more than the phone sheet probes");
});
