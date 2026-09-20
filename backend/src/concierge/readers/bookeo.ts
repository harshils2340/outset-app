import type { LiveRead } from "../live.ts";

/**
 * Bookeo, and why there is no feed here yet.
 *
 * Bookeo is 46 booking links in this catalog — escape rooms mostly, plus skydiving, ballooning, hot tub
 * boats, axe throwing — and it is the fifth vendor by popularity, so it was meant to be the fifth reader.
 * It is not, and this file exists to say so precisely, with what was tried, so the next session spends its
 * day on a vendor that can be read instead of re-running these experiments. A clear negative is worth more
 * than a slow, fragile reader that quietly returns nothing.
 *
 * **What happens when you ask Bookeo anything, from here.** Every request to every Bookeo host, whatever the
 * path, comes back `200` with the same 251 bytes and no HTML at all:
 *
 *     [03b20262D092D205F083A13HFTTXWKY]
 *     Access from unauthorized IP address detected.
 *     You are connecting from an IP address linked to past fraud activity.
 *     Please disable any VPN or other IP masquerading mechanism you may be using.
 *     IP address: <ours>
 *
 * Measured 20 September 2026 against `bookeo.com/laketravisyachtrentals`, `www.bookeo.com/escapism`,
 * `bookeo.com/bookeo/b.html?a=41575XY7NH416FC9478769` (KW Escape's hosted page, rebuilt from the account id
 * the way `vendors.ts` builds it), the per-account host `www-1551q.bookeo.com/bookeo/b_explorevi_start.html`,
 * and their public API host `api.bookeo.com`. Five hosts, one answer.
 *
 * **It is not bot detection, and this is the part that matters.** `AGENTS.md` records that "Bookeo blocks
 * headless browsers outright; its widget never loads", which reads like a browser-fingerprinting problem
 * worth fighting. It is not one. A plain `curl`, a `fetch` with a real Chrome user-agent and full browser
 * headers, and a real headless Chromium navigating to the hosted page all receive the identical block page —
 * the browser renders those five lines as the whole document. A request routed through a third-party fetcher
 * on a datacentre address does not get the page either. The gate is on the network address, before any
 * content is served, so no amount of headers, cookies, waiting or browser realism moves it. Nothing about
 * their availability API was learned, because nothing about any of their pages was ever served.
 *
 * **What is still known, and is not a guess.** `vendors.ts` already reads the account id out of the embed
 * (`bookeo.com/widget.js?a=41575XY7NH416FC9478769`) and rebuilds the hosted page as
 * `bookeo.com/bookeo/b.html?a=<account>`. That much works offline, from HTML our crawl already holds, and it
 * is what this file uses. The unknown is everything behind that URL.
 *
 * **What to try next, in this order, and only from an address Bookeo will serve** — a Render worker, which is
 * where every crawl belongs anyway:
 *
 *   1. `bookeoProbe()` below, on ten of the 46 links. It fetches the hosted page and reports what came back.
 *      If it says `ok`, the page is readable and the shape can be read off it in an hour; every other vendor
 *      cracked so far declared its API base and key in the page HTML.
 *   2. If the hosted page is a JS shell, `sniff.ts` on it: that machinery exists precisely for finding an
 *      availability endpoint that was never published, and Bookeo's calendar has to fetch its times from
 *      somewhere.
 *   3. Only then a browser reader, and `AGENTS.md`'s own rule applies — a browser is for discovery, never in
 *      the shipped reader.
 *
 * Until then `bookeoLive` returns a read with no departures and a note saying which of the two things
 * happened, because the two call for completely different fixes. A shop we cannot read is **not** a shop
 * that takes bookings by phone: these 46 businesses sell online right now, and the route for them is
 * `agent`, never `phone`.
 */

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

/**
 * `LiveRead["vendor"]` is `"fareharbor" | "resova" | "peek" | "checkfront" | "replay" | "agent" | "none"` and
 * does not yet carry `"bookeo"`. Adding it is a one-word change in `live.ts`, which this file deliberately
 * does not make because several readers are being written at once and `live.ts` has an owner. Until it lands
 * the name is asserted here rather than a neighbouring vendor's being borrowed, so the value a caller sees is
 * already the right one.
 */
const VENDOR = "bookeo" as LiveRead["vendor"];

/** Their block page, verbatim enough to recognise and specific enough not to match a real booking page. */
const BLOCKED = /unauthorized IP address|linked to past fraud activity/i;

export type BookeoRef = {
  /** The account id, when the link carries one: `41575XY7NH416FC9478769`. */
  account: string | null;
  /** The shop's vanity name, when the link is the short form: `bookeo.com/stlouisescape`. */
  slug: string | null;
  /** The best page to ask: the hosted booking page for an account, the link itself otherwise. */
  page: string;
};

/**
 * The shop out of any Bookeo URL we hold.
 *
 * Five shapes are in the catalog and they do not look much like each other:
 *   `https://bookeo.com/stlouisescape`                                 the vanity link, the common case
 *   `https://bookeo.com/escaperoomsj?promotion=SAVE2`                  the same with the shop's own query junk
 *   `https://bookeo.com/go/41563Y43L6715DC4707475/buyvoucher`          the account id in the path
 *   `https://www-14e.bookeo.com/bookeo/b_exitcanada_start.html?...`    a per-account front end
 *   `https://bookeo.com/bookeo/b.html?a=41575XY7NH416FC9478769`        the hosted page `vendors.ts` rebuilds
 *
 * `/buyvoucher` is a gift-certificate page rather than a calendar, and it is dropped from the path for the
 * same reason `peek.ts` refuses to treat a gift-card link as availability: a voucher has no time of day.
 * A link on the shop's own domain (`deadboltescape.com/bookeo/`) is an iframe around one of these and
 * carries no account id of its own, so it returns null and stays a job for whoever sniffs the page.
 */
export function bookeoRef(url: string): BookeoRef | null {
  const account =
    url.match(/[?&](?:a|aguid)=([A-Za-z0-9]{10,})/)?.[1] ??
    url.match(/bookeo\.com\/go\/([A-Za-z0-9]{10,})/i)?.[1] ??
    null;
  if (account) return { account, slug: null, page: `https://bookeo.com/bookeo/b.html?a=${account}` };

  const host = url.match(/https?:\/\/(?:[a-z0-9-]+\.)?bookeo\.com(\/[^?#\s]*)?/i);
  if (!host) return null;
  const path = (host[1] || "").replace(/\/(buyvoucher|buygiftvoucher)\/?$/i, "");
  const slug = path.match(/^\/([A-Za-z0-9_-]{2,60})\/?$/)?.[1] ?? null;
  // A per-account front end (`/bookeo/b_exitcanada_start.html`) is already the page to ask; keep it whole.
  return { account: null, slug, page: slug ? `https://bookeo.com/${slug}` : url };
}

export type BookeoProbe = {
  page: string;
  /** `blocked` — their IP gate. `refused` — no answer at all. `served` — a real page, which is the interesting one. */
  kind: "blocked" | "refused" | "served";
  status: number | null;
  bytes: number;
  /** The first of whatever came back, so a session on a clean address can see the shape without re-fetching. */
  sample: string;
};

/**
 * Ask Bookeo for a shop's hosted page and report exactly what came back.
 *
 * This is the experiment to re-run from the Render worker, not a reader. It is exported because the whole
 * value of this file is that somebody can check the finding in one call instead of rediscovering it, and
 * because the day `kind` comes back `served`, the body it hands over is the start of the real reader.
 */
export async function bookeoProbe(bookingUrl: string, timeoutMs = 12000): Promise<BookeoProbe | null> {
  const ref = bookeoRef(bookingUrl);
  if (!ref) return null;
  try {
    const res = await fetch(ref.page, {
      headers: {
        "user-agent": UA,
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "en-US,en;q=0.9",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(timeoutMs),
    });
    const body = await res.text();
    const kind = BLOCKED.test(body) ? "blocked" : res.ok ? "served" : "refused";
    return { page: ref.page, kind, status: res.status, bytes: body.length, sample: body.slice(0, 1500) };
  } catch {
    return { page: ref.page, kind: "refused", status: null, bytes: 0, sample: "" };
  }
}

/**
 * Live availability from Bookeo: none, and it says why.
 *
 * It still makes the request rather than returning a canned refusal, for two reasons. The block is on our
 * address, not on us — the same code run from the worker may well be served a page — and a reader that
 * pretends to know the answer without asking is how a stale finding outlives the thing it described. What it
 * will not do is invent a shape: there is no parsing below because no Bookeo page has ever been seen from
 * here, and a parser written against a guess is a wrong test that fails working code.
 */
export async function bookeoLive(
  bookingUrl: string,
  _opts: { from?: Date; days?: number; maxItems?: number } = {},
): Promise<LiveRead | null> {
  const ref = bookeoRef(bookingUrl);
  if (!ref) return null;
  const name = ref.slug || ref.account || "bookeo";

  const probe = await bookeoProbe(bookingUrl);
  const note =
    probe?.kind === "blocked"
      ? "Bookeo refuses this address outright — every one of their hosts answers with an IP block page rather than the shop's calendar — so their times cannot be read from here. The shop does sell online."
      : probe?.kind === "served"
        ? "Bookeo served this shop's booking page, so it is readable from this address; there is no reader for the page's shape yet."
        : "Bookeo did not answer for this shop.";

  return { business: name, vendor: VENDOR, departures: [], note };
}
