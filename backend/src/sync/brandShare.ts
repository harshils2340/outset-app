/**
 * Chain locations share their brand's content.
 *
 * Florida discovery adds one listing per chain location (chain-massageenvy-aventura-b8a4f5), and every location's
 * website is a page on the brand's own site. The photos, class menu, description and house rules on that site are
 * the brand's, identical at every branch; the address, phone, pin and opening hours are the location's own. So
 * crawling each of 93 Massage Envy location pages would read the same brand site 93 times, slowly and impolitely,
 * to learn one thing. Instead the queues carry one row per brand, `brand:<host>`, and at sync every location of
 * that brand takes the brand's crawled photos, services and descriptive facts, keeping its own location facts.
 */

export const BRAND_PREFIX = "brand:";

export function isChainLocation(domain: string | null | undefined): boolean {
  return !!domain && domain.startsWith("chain-");
}

export function siteHost(url: string | null | undefined): string {
  try {
    return new URL(String(url || "").startsWith("http") ? String(url) : "https://" + url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

export function brandId(website: string | null | undefined): string {
  const h = siteHost(website);
  return h ? BRAND_PREFIX + h : "";
}

/** Facts that belong to one branch, never copied from the brand site to a location. */
export const LOCATION_FACT = /^(hours|hours_text|phone|email|street|address|city|postal|meeting_point|checkin|parking|directions|contact|booking_url|waiver_url)$/;

/**
 * Collapse chain locations in a work list to one row per brand site, pointed at the brand's home page. Rows that
 * are not chain locations pass through untouched and keep their order.
 */
export function collapseChains<T extends { id: string; domain: string; website: string; name: string }>(rows: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const r of rows) {
    if (!isChainLocation(r.domain)) {
      out.push(r);
      continue;
    }
    const host = siteHost(r.website);
    if (!host || seen.has(host)) continue;
    seen.add(host);
    // The brand name without the branch: "Massage Envy - Aventura" -> "Massage Envy".
    const brand = r.name.replace(/\s+[-–|@,]\s+.*$/, "").replace(/\s+(of|at|in)\s+[A-Z][\w .'-]*$/, "").trim() || r.name;
    out.push({ ...r, id: BRAND_PREFIX + host, domain: host, website: "https://" + host + "/", name: brand });
  }
  return out;
}
