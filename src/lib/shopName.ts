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
 *
 * A semicolon with nothing after it is one value, not two: OpenStreetMap joins a tag's several values that
 * way, so 25 shipped names are two names glued into one. Most are a shop and its own alternative spelling
 * ("Paper Mill Playhouse;Papermill Playhouse", "Browns Crafthouse Kitchen & Bar;Browns Crafthouse") and some
 * are two businesses sharing an address ("Fun Factory;Taco Bell", "Las Vegas Shooting Center;Hollywood Car
 * Museum"), and every one of them was printed whole, on the card, the hero and in Otto's answers. The half the
 * shop's own domain names wins, which is how a Taco Bell on locations.tacobell.com stops being a Fun Factory;
 * with no domain to go on, OpenStreetMap's own first value stands. A semicolon the shop wrote itself is
 * followed by a space, as the 5 partner products that carry one are ("City tour; afternoon in Montreal"), and
 * that is punctuation inside one name, so it stays.
 */
export function shopTitle(raw: string, domain?: string | null): string {
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
  if (/;\S/.test(t)) {
    const letters = (x: string) => x.toLowerCase().replace(/[^a-z0-9]+/g, "");
    // The label the business is registered under: "tacobell" out of locations.tacobell.com.
    const labels = (domain || "").toLowerCase().replace(/^https?:\/\//, "").split("/")[0].split(".").filter(Boolean);
    const key = letters(labels.length > 1 ? labels[labels.length - 2] : labels[0] || "");
    // A name's worth of letters on both sides before a domain can be said to carry one: "nmm.life" names
    // neither of its two halves, and three letters would carry almost anything.
    const names = (x: string) => key.length >= 5 && letters(x).length >= 5 && (key.includes(letters(x)) || letters(x).includes(key));
    const parts = t.split(/;(?=\S)/).map((x) => x.trim()).filter((x) => x.length >= 3);
    // The fullest of the halves the domain names ("Browns Crafthouse Kitchen & Bar" over "Browns Crafthouse").
    const named = parts.filter(names).sort((a, b) => b.length - a.length)[0];
    t = named || parts[0] || t;
  }
  return t.length >= 3 ? t : name;
}
