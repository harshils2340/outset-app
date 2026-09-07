import { load } from "cheerio";

export type ExtractedOffer = {
  name: string;
  detail: string;
  duration: string | null;
  priceCents: number | null;
  priceUnit: string | null;
};

export type ExtractedPage = {
  name: string | null;
  description: string | null;
  telephone: string | null;
  email: string | null;
  street: string | null;
  city: string | null;
  region: string | null;
  postal: string | null;
  country: string | null;
  offers: ExtractedOffer[];
  hours: string[];
  calendarVendor: string | null;
  extraPages: string[];
};

const VENDORS: { id: string; re: RegExp }[] = [
  { id: "fareharbor", re: /fareharbor\.com/i },
  { id: "peek", re: /peek\.com|peekpro/i },
  { id: "checkfront", re: /checkfront\.com/i },
  { id: "rezdy", re: /rezdy\.com/i },
  { id: "xola", re: /xola\.com/i },
  { id: "booksy", re: /booksy\.com/i },
  { id: "squareup", re: /squareup\.com\/appointments|square\.site/i },
  { id: "simplybook", re: /simplybook\.me/i },
];

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function asArray(v: unknown): unknown[] {
  if (Array.isArray(v)) return v;
  if (v == null) return [];
  return [v];
}

function str(v: unknown): string | null {
  if (typeof v === "string" && v.trim()) return v.trim();
  if (typeof v === "number") return String(v);
  return null;
}

function moneyToCents(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v) && v > 0) {
    return v >= 10000 ? Math.round(v) : Math.round(v * 100);
  }
  if (typeof v === "string") {
    const f = Number(v.replace(/[^0-9.]/g, ""));
    if (!Number.isFinite(f) || f <= 0) return null;
    return Math.round(f * 100);
  }
  return null;
}

function parseJsonLd(html: string): Record<string, unknown>[] {
  const $ = load(html);
  const out: Record<string, unknown>[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).contents().text();
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) parsed.forEach((p) => { const r = asRecord(p); if (r) out.push(r); });
      else {
        const r = asRecord(parsed);
        if (r) {
          if (Array.isArray(r["@graph"])) {
            for (const g of r["@graph"]) {
              const gr = asRecord(g);
              if (gr) out.push(gr);
            }
          } else out.push(r);
        }
      }
    } catch {
      /* ignore broken ld+json */
    }
  });
  return out;
}

function fromAddress(addr: unknown): Pick<ExtractedPage, "street" | "city" | "region" | "postal" | "country"> {
  const a = asRecord(addr);
  if (!a) return { street: null, city: null, region: null, postal: null, country: null };
  return {
    street: str(a.streetAddress),
    city: str(a.addressLocality),
    region: str(a.addressRegion),
    postal: str(a.postalCode),
    country: str(a.addressCountry),
  };
}

function offersFromLd(nodes: Record<string, unknown>[]): ExtractedOffer[] {
  const offers: ExtractedOffer[] = [];
  for (const n of nodes) {
    for (const off of asArray(n.offers)) {
      const o = asRecord(off);
      if (!o) continue;
      const price = moneyToCents(o.price ?? o.lowPrice);
      const name = str(o.name) || str(n.name) || "Listed offer";
      if (!price && !str(o.name)) continue;
      offers.push({
        name,
        detail: str(o.description) || "",
        duration: str(o.duration),
        priceCents: price,
        priceUnit: str(o.priceCurrency) === "USD" || str(o.priceCurrency) === "CAD" ? "each" : str(o.unitText),
      });
    }
  }
  return offers;
}

const DAY_SHORT: Record<string, string> = {
  monday: "Mo", tuesday: "Tu", wednesday: "We", thursday: "Th", friday: "Fr", saturday: "Sa", sunday: "Su",
};

/** Flatten schema.org openingHoursSpecification into "Mo-Fr 09:00-17:00" style strings. */
function hoursFromSpec(spec: unknown): string[] {
  const out: string[] = [];
  for (const item of asArray(spec)) {
    const r = asRecord(item);
    if (!r) continue;
    const days = asArray(r.dayOfWeek)
      .map((d) => {
        const raw = str(d) || "";
        const key = raw.replace(/^https?:\/\/schema\.org\//i, "").toLowerCase();
        return DAY_SHORT[key] || null;
      })
      .filter((d): d is string => !!d);
    const opens = str(r.opens);
    const closes = str(r.closes);
    if (!days.length || !opens || !closes) continue;
    out.push(days.join(",") + " " + opens.slice(0, 5) + "-" + closes.slice(0, 5));
  }
  return out;
}

/** North American phone printed as visible text. Used only when the site has no tel: link or schema.org phone. */
function phoneFromText(text: string): string | null {
  const m = text.match(/(?:\+?1[\s.-]?)?\(?([2-9]\d{2})\)?[\s.-]?(\d{3})[\s.-]?(\d{4})(?!\d)/);
  if (!m) return null;
  return "+1" + m[1] + m[2] + m[3];
}

export function extractPage(html: string, pageUrl: string): ExtractedPage {
  const $ = load(html);
  const ld = parseJsonLd(html);
  const biz = ld.find((n) => {
    const t = String(n["@type"] || "");
    return /LocalBusiness|SportsActivityLocation|TouristAttraction|Organization|Store/i.test(t);
  }) || ld[0] || {};

  const addr = fromAddress(biz.address);
  const ogName = $('meta[property="og:site_name"]').attr("content") || $('meta[property="og:title"]').attr("content") || null;
  const title = $("title").first().text().trim() || null;
  const telHref = $('a[href^="tel:"]').first().attr("href");
  const mailHref = $('a[href^="mailto:"]').first().attr("href");

  let calendarVendor: string | null = null;
  const blob = html.slice(0, 200000);
  for (const v of VENDORS) {
    if (v.re.test(blob)) {
      calendarVendor = v.id;
      break;
    }
  }

  const extraPages: string[] = [];
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;
    try {
      const abs = new URL(href, pageUrl);
      if (abs.origin !== new URL(pageUrl).origin) return;
      if (/contact|pricing|rates|tours|rentals|faq|about/i.test(abs.pathname) && extraPages.length < 5) {
        extraPages.push(abs.toString());
      }
    } catch {
      /* ignore */
    }
  });

  const hours = [
    ...asArray(biz.openingHours).map(str).filter((x): x is string => !!x),
    ...hoursFromSpec(biz.openingHoursSpecification),
  ];
  const bodyText = $("body").text().replace(/\s+/g, " ");

  return {
    name: str(biz.name) || ogName || title,
    description: str(biz.description) || $('meta[name="description"]').attr("content") || null,
    telephone: str(biz.telephone) || (telHref ? telHref.replace(/^tel:/i, "") : null) || phoneFromText(bodyText),
    email: str(biz.email) || (mailHref ? mailHref.replace(/^mailto:/i, "").split("?")[0] : null),
    ...addr,
    offers: offersFromLd(ld),
    hours,
    calendarVendor,
    extraPages: [...new Set(extraPages)],
  };
}
