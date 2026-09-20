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
  | "eventbrite" | "wix" | "unknown";

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
  detect: RegExp;
  account?: RegExp;
  hosted?: (account: string) => string;
  hasFeed?: boolean;
}[] = [
  {
    vendor: "fareharbor",
    detect: /fareharbor\.com/i,
    account: /fareharbor\.com\/(?:embeds\/book\/)?([a-z0-9][a-z0-9-]{2,})/i,
    hosted: (a) => `https://fareharbor.com/embeds/book/${a}/`,
    hasFeed: true,
  },
  {
    vendor: "checkfront",
    detect: /checkfront\.com/i,
    account: /([a-z0-9][a-z0-9-]{2,})\.checkfront\.com/i,
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
    account: /peek\.com\/s\/([a-z0-9-]{6,})/i,
    hosted: (a) => `https://book.peek.com/s/${a}`,
  },
  {
    vendor: "xola",
    detect: /xola\.com/i,
    account: /xola\.com\/(?:api\/)?(?:experiences\/)?([a-f0-9]{16,})/i,
  },
  {
    vendor: "resova",
    detect: /resova\.(?:com|us|eu)/i,
    account: /([a-z0-9-]{3,})\.resova\.(?:com|us|eu)/i,
    hosted: (a) => `https://${a}.resova.com/`,
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

/** Recognise the vendor from any text that came off the shop's page: the HTML, a script src, an iframe src. */
export function detectVendor(haystack: string): VendorHit {
  for (const r of RULES) {
    if (!r.detect.test(haystack)) continue;
    const account = r.account ? haystack.match(r.account)?.[1] ?? null : null;
    return {
      vendor: r.vendor,
      account,
      hostedUrl: account && r.hosted ? r.hosted(account) : null,
      hasFeed: !!r.hasFeed,
      evidence: (haystack.match(r.detect)?.[0] || r.vendor).slice(0, 60),
    };
  }
  return { vendor: "unknown", account: null, hostedUrl: null, hasFeed: false, evidence: "" };
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
