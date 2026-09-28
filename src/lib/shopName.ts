/**
 * The business name as a guest should read it, with the punctuation the crawl left in it closed up.
 *
 * The name is the most printed string in the product: the card, the page hero, the booking sheet, the
 * confirmation, the static page, the outreach email and every answer Otto gives that says who confirms a
 * booking. 58 shipped names carry a mark that is not theirs. 42 have a space in front of a comma or a colon,
 * so Otto said "Pick a service and time on this page and Tac Ops : A Tactical Laser Tag Experience confirms
 * it", and a Viator row reads "Quebec City : Bike Excursion to Montmorency Falls". Two end on a bracket the
 * crawl never closed, "2 Hour Guided Segway Tour (" and "Trans-Allegheny Lunatic Asylum (West Virginia
 * Hospital for the", and one on a bracket it never opened, "Quack N' Cruise Portland Maine Duck Tours)".
 * Three end on a separator with nothing after it, "Pilates &" and "Pub de la Microbrasserie de Tadoussac;",
 * and one opens on one, ";Water Street Brewing Company".
 *
 * A space in front of a final question or exclamation mark says the mark is the page's, not the name's, so
 * "Siesta Key Fishing Charters-Inshore & Offshore Fishing Trips ?" loses it while an escape room called "Who
 * Stole Mona?" keeps its own. "Arts+" and "& Fitness" keep their sign, because a shop can be named for one.
 */
export function shopTitle(raw: string): string {
  const name = String(raw || "").replace(/\s+/g, " ").trim();
  if (!name) return name;
  let t = name;
  // A bracket with nothing closing it, and whatever the crawl swept up behind it.
  if ((t.match(/\(/g) || []).length > (t.match(/\)/g) || []).length) t = t.slice(0, t.lastIndexOf("(")).trim();
  if (/^[^()]*\)/.test(t)) t = t.replace(/\s*\)/, "").trim();
  t = t
    .replace(/\s+([,;:])/g, "$1")
    .replace(/\s+([!?])\s*$/, "")
    .replace(/^[\s,;:|]+/, "")
    .replace(/[\s,;:|&/–—-]+$/, "")
    .replace(/\s+/g, " ")
    .trim();
  return t.length >= 3 ? t : name;
}
