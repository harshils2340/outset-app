/**
 * Who runs this shop's bookings, and where their own booking page lives.
 *
 * Operators embed a widget in their marketing site, and the widget is nearly always an iframe pointing at the
 * vendor, carrying the shop's account id in the URL: `bookeo.com/widget.js?a=41575XY7NH416FC9478769`,
 * `adventureroomscanada.checkfront.com`, `fareharbor.com/embeds/book/torontohelitours/`. That id is the key to
 * everything, because every one of these vendors also serves a plain hosted booking page for the same account.
 *
 * Going to the hosted page instead of the embed is the difference between driving a widget inside an iframe
 * inside somebody's WordPress theme, and opening one ordinary page. It is the same booking engine either way.
 *
 * So: read the shop's page once, work out the vendor and the account, then deal with the vendor directly.
 */

export type VendorId =
  | "fareharbor" | "peek" | "xola" | "checkfront" | "bookeo" | "resova" | "rezdy"
  | "acuity" | "square" | "setmore" | "calendly" | "mindbody" | "tripworks" | "bookwhen"
  | "eventbrite" | "wix" | "foreup" | "unknown";

export type VendorHit = {
  vendor: VendorId;
  /** The shop's id with that vendor, when the page gave one up. */
  account: string | null;
  /** The vendor's own booking page for this shop, when we can build one. */
  hostedUrl: string | null;
  /** True when the vendor answers in JSON without a browser, which is always better. */
  hasFeed: boolean;
  /** Where we saw it, for when this gets something wrong and somebody has to work out why. */
  evidence: string;
};

/**
 * Each vendor: how to recognise it, how to pull the account id out, and how to build the hosted URL.
 * Order matters only in that the first match wins, so the specific patterns are listed before the loose ones.
 */
const RULES: {
  vendor: VendorId;
  /** Tried in order; the first that yields an id which is not the vendor's own wins. */
  account?: RegExp | RegExp[];
  detect: RegExp;
  /** Given the account and the text it was read from, so a shop on `.resova.us` is not sent to `.resova.com`. */
  hosted?: (account: string, haystack: string) => string;
  hasFeed?: boolean;
}[] = [
  {
    // Golf's own vendor: a course embeds a plain link or iframe to its own booking page rather than a widget
    // with a separate account id, so the "account" is just the course (and, where named, schedule) path.
    vendor: "foreup",
    detect: /foreupsoftware\.com/i,
    account: /foreupsoftware\.com\/index\.php\/booking\/(\d+(?:\/\d+)?)/i,
    hosted: (a) => `https://foreupsoftware.com/index.php/booking/${a}`,
    hasFeed: true,
  },
  {
    vendor: "fareharbor",
    detect: /fareharbor\.com/i,
    // A waiver link names the company outright: fareharbor.com/waivers?shortname=enrgkayaking&bookingUuid=...
    account: [/[?&]shortname=([a-z0-9-]+)/i, /fareharbor\.com\/(?:embeds\/book\/)?([a-z0-9][a-z0-9-]{2,})/i],
    hosted: (a) => `https://fareharbor.com/embeds/book/${a}/`,
    hasFeed: true,
  },
  {
    // The newer storefront is <account>.checkfront.site; the booking engine is the same either way.
    vendor: "checkfront",
    detect: /checkfront\.(?:com|site)/i,
    account: /([a-z0-9][a-z0-9-]{2,})\.checkfront\.(?:com|site)/i,
    hosted: (a) => `https://${a}.checkfront.com/reserve/`,
  },
  {
    vendor: "bookeo",
    detect: /bookeo\.com/i,
    // The widget script carries it: widget.js?a=41575XY7NH416FC9478769, and the iframe repeats it as aguid=.
    account: /bookeo\.com\/[^"'\s]*[?&](?:a|aguid)=([A-Za-z0-9]{10,})/i,
    hosted: (a) => `https://bookeo.com/bookeo/b.html?a=${a}`,
  },
  {
    vendor: "peek",
    detect: /(?:book\.)?peek\.com/i,
    /**
     * Peek writes the same account three ways and this only knew one of them. `/s/<uuid>` is the common
     * form, `/w/<uuid>` turns up just as often, and plenty of links are on `www.peek.com` rather than
     * `book.`. Matching only the first shape filed the rest as accountless and unreadable, on a vendor that
     * answers in JSON in about a second.
     */
    account: /peek\.com\/(?:s|w)\/([a-z0-9-]{6,})/i,
    hosted: (a) => `https://book.peek.com/s/${a}`,
    hasFeed: true,
  },
  {
    /**
     * Half of Xola lives on `xola.app`, not `xola.com`: `x2-checkout.xola.app/flows/mvp?button=...` and
     * `gift.xola.app`. 27 of the 54 Xola booking links we ship are on that host and read as no vendor at all.
     * The seller is `#seller/<id>` or `sellerId=<id>`; a button embed carries only a button id, which
     * `readXola` swaps for a seller, so it is marked as one rather than passed off as a seller.
     */
    vendor: "xola",
    detect: /xola\.(?:com|app)/i,
    account: [/(?:seller\/|[?&]sellerId=)([a-f0-9]{24})\b/i, /(?:buttons?\/|[?&#]button=)([a-f0-9]{24})\b/i],
  },
  {
    vendor: "resova",
    detect: /resova\.(?:com|us|eu)/i,
    account: /([a-z0-9-]{3,})\.resova\.(?:com|us|eu)/i,
    hosted: (a, text) => `https://${a}.resova.${text.match(/resova\.(com|us|eu)/i)?.[1].toLowerCase() || "com"}/`,
  },
  {
    vendor: "rezdy",
    detect: /rezdy\.com/i,
    account: /([a-z0-9-]{3,})\.rezdy\.com/i,
    hosted: (a) => `https://${a}.rezdy.com/`,
  },
  {
    vendor: "acuity",
    detect: /acuityscheduling\.com|squarespace-scheduling\.com|\bas\.me\b/i,
    account: /(?:owner=|schedule\.php\?owner=)(\d{5,})/i,
    hosted: (a) => `https://app.acuityscheduling.com/schedule.php?owner=${a}`,
  },
  {
    vendor: "square",
    detect: /squareup\.com\/appointments|square\.site\/book|book\.squareup\.com/i,
    account: /squareup\.com\/appointments\/book\/([a-z0-9-]{6,})/i,
    hosted: (a) => `https://squareup.com/appointments/book/${a}`,
  },
  { vendor: "setmore", detect: /setmore\.com/i, account: /([a-z0-9-]{3,})\.setmore\.com/i, hosted: (a) => `https://${a}.setmore.com/` },
  { vendor: "calendly", detect: /calendly\.com/i, account: /calendly\.com\/([a-z0-9-]{3,})/i, hosted: (a) => `https://calendly.com/${a}` },
  { vendor: "mindbody", detect: /mindbodyonline\.com|mindbody\.io/i, account: /studioid=(\d{4,})/i },
  { vendor: "tripworks", detect: /tripworks\.com/i, account: /([a-z0-9-]{3,})\.tripworks\.com/i, hosted: (a) => `https://${a}.tripworks.com/` },
  { vendor: "bookwhen", detect: /bookwhen\.com/i, account: /bookwhen\.com\/([a-z0-9-]{3,})/i, hosted: (a) => `https://bookwhen.com/${a}` },
  { vendor: "eventbrite", detect: /eventbrite\.(?:com|ca)/i, account: /eventbrite\.(?:com|ca)\/o\/([a-z0-9-]+)/i },
  // Wix last: every Wix site mentions wix somewhere, so it must not win over a real booking vendor.
  { vendor: "wix", detect: /bookings-viewer|wix\.com\/_api\/bookings|booking-calendar/i },
];

/**
 * A vendor's own site is not one of its accounts. Most of these ids are read out of a subdomain or the first
 * path segment, and a shop's booking page nearly always links back to the vendor as well: the powered-by badge
 * on a Checkfront page is `www.checkfront.com`, so the account came back as "www" and the hosted booking page we
 * built for that shop was `https://www.checkfront.com/reserve/`, which is Checkfront's own marketing site.
 */
const NOT_AN_ACCOUNT = /^(?:www|help|support|blog|docs|api|app|apps|cdn|assets|static|status|secure|info|news|embeds|widgets|book|booking|pages|legal|about|contact|login|signup|partners|waivers|waiver|terms|privacy|gift|checkout|templates|preview|flows|index\.html)$/i;

/**
 * The first id on the page that could be a shop rather than the vendor itself. Taking the first match outright
 * meant one link to the vendor's own site, higher up the page than the widget, decided the account.
 */
function accountIn(haystack: string, res: RegExp | RegExp[]): string | null {
  for (const re of Array.isArray(res) ? res : [res]) {
    const all = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
    for (const m of haystack.matchAll(all)) {
      if (m[1] && !NOT_AN_ACCOUNT.test(m[1])) return m[1];
    }
  }
  return null;
}

/**
 * Recognise the vendor from any text that came off the shop's page: the HTML, a script src, an iframe src.
 *
 * A rule that finds the shop's own id beats one that only saw the vendor's name, whatever order they sit in:
 * a page that links to `fareharbor.com/legal/privacy/` and embeds a Peek widget is a Peek shop, and returning
 * FareHarbor with no account leaves it with neither a feed to read nor a hosted page to open.
 */
export function detectVendor(haystack: string): VendorHit {
  let fallback: VendorHit | null = null;
  for (const r of RULES) {
    if (!r.detect.test(haystack)) continue;
    const account = r.account ? accountIn(haystack, r.account) : null;
    const hit: VendorHit = {
      vendor: r.vendor,
      account,
      hostedUrl: account && r.hosted ? r.hosted(account, haystack) : null,
      hasFeed: !!r.hasFeed,
      evidence: (haystack.match(r.detect)?.[0] || r.vendor).slice(0, 60),
    };
    if (account) return hit;
    fallback = fallback || hit;
  }
  return fallback || { vendor: "unknown", account: null, hostedUrl: null, hasFeed: false, evidence: "" };
}

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

/**
 * Fetch the shop's booking page and work out who runs it. Plain HTTP: the vendor's name is in the markup that
 * arrives, because the embed script tag is server-rendered even when the widget itself draws later. Only when
 * the HTML says nothing does this need a browser, and that is what `readWithBrowser` is for.
 */
export async function vendorOf(bookingUrl: string): Promise<VendorHit> {
  const direct = detectVendor(bookingUrl);
  if (direct.vendor !== "unknown" && direct.account) return direct;
  try {
    const res = await fetch(bookingUrl, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(15000), redirect: "follow" });
    if (!res.ok) return direct;
    const html = (await res.text()).slice(0, 900_000);
    const found = detectVendor(html + " " + res.url);
    // A vendor named in the link itself beats one merely mentioned in the page's scripts.
    return found.vendor !== "unknown" ? found : direct;
  } catch {
    return direct;
  }
}
