/**
 * Which booking software each operator already runs, and what we can do with it.
 *
 * The site crawl leaves the operator's booking link in facts as `booking_url` / `online_booking`.
 * That link names the vendor: `fareharbor.com/embeds/book/<shortname>/` is FareHarbor,
 * `<studio>.checkfront.com` is Checkfront, `clients.mindbodyonline.com` is Mindbody, and so on.
 * This module turns a link (or a page's HTML) into a vendor id, and says honestly what that
 * vendor lets us read TODAY with public endpoints and no partner credentials.
 *
 * Capability honesty rules used here:
 *   - `catalog` / `availability` / `book` are true ONLY where an unauthenticated endpoint is named
 *     in `note` and is already exercised by our own code (src/enrich/widgets.ts).
 *   - Everything else is false. Where a likely-public endpoint exists but nobody has probed it,
 *     the cap stays false and `note` names the endpoint to test. Optimism is not a capability.
 *   - `partner` means the vendor does publish an API for this, but it is gated behind a signed
 *     partner / affiliate / channel-manager agreement or a per-seller OAuth grant.
 *
 * Nothing in this file makes a network call.
 */

export type VendorKind =
  | "tours"        // tour & activity reservation systems (FareHarbor, Peek, Rezdy...)
  | "activities"   // attractions, rentals, entertainment venue systems (Roller, CenterEdge...)
  | "golf"         // tee-sheet software
  | "fitness"      // class / studio scheduling
  | "wellness"     // spa, salon, massage, clinic booking
  | "restaurant"   // table reservation platforms
  | "marketplace"  // third-party listing sites: NOT the operator's own booking software
  | "scheduler"    // generic calendar/appointment tools (Calendly, Acuity, Square)
  | "other";       // lodging, campgrounds, ticketing, parks, forms and everything else

export type VendorCaps = {
  /** We can read their services / prices from a public endpoint. */
  catalog: boolean;
  /** We can read open dates and times from a public endpoint. */
  availability: boolean;
  /** We can create a real booking from a public endpoint. */
  book: boolean;
  /** They have an API for this, but it needs a signed partner deal or per-seller OAuth first. */
  partner: boolean;
};

export type Vendor = {
  id: string;
  /** How a human names it. */
  label: string;
  kind: VendorKind;
  /** Regexes over a booking URL. Anchored at the scheme so query strings cannot false-positive. */
  match: RegExp[];
  /** Regexes over page HTML (script src, embed attributes, iframe hosts) so a later crawl can
   *  detect the vendor on an operator page that has no booking link. */
  html?: RegExp[];
  caps: VendorCaps;
  note?: string;
};

export type VendorId = string;

/* ---------- helpers ---------- */

const esc = (d: string) => d.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Host match: the domain itself or any subdomain of it, at the start of the URL. */
function host(...domains: string[]): RegExp[] {
  return domains.map((d) => new RegExp("^https?://(?:[a-z0-9-]+\\.)*" + esc(d) + "(?:[:/?#]|$)", "i"));
}

/** Host + required path prefix, for shared hosts like squareup.com. */
function hostPath(domain: string, path: string): RegExp {
  return new RegExp("^https?://(?:[a-z0-9-]+\\.)*" + esc(domain) + "(?::\\d+)?" + path, "i");
}

/** Any mention of a host inside page HTML (script src, iframe src, data attributes). */
function inHtml(...domains: string[]): RegExp[] {
  return domains.map((d) => new RegExp("(?:src|href|action|data-[a-z-]+)\\s*=\\s*[\"'][^\"']*(?:[a-z0-9-]+\\.)*" + esc(d) + "/", "i"));
}

const CAPS_NONE: VendorCaps = { catalog: false, availability: false, book: false, partner: false };
const caps = (c: Partial<VendorCaps>): VendorCaps => ({ ...CAPS_NONE, ...c });

/* ---------- links that are not booking software at all ---------- */

/**
 * Share buttons, link wrappers, dead anchors and file links that the crawl picked up as a
 * "booking link". These are never a vendor. detectVendor unwraps the wrappers it can and
 * returns null for the rest, so the caller counts the operator as having no booking software.
 */
const NOT_BOOKING: RegExp[] = [
  /^javascript:/i,
  /^(tel|mailto|sms|fax|callto):/i,
  /^#/,
  ...host("facebook.com", "instagram.com", "pinterest.com", "twitter.com", "x.com", "youtube.com", "youtu.be", "tiktok.com", "linkedin.com"),
  ...host("canva.com", "livehelpnow.net", "cdn-website.com", "wpengine.com", "vercel.app", "wixsite.com", "weebly.com", "wordpress.com"),
  hostPath("google.com", "/(?:maps|search|url|store|calendar/event)"),
  hostPath("google.com", "/?$"),
  ...host("drive.google.com"),
  hostPath("docs.google.com", "/(?:document|spreadsheets|presentation|file)"),
  // Link shorteners: we cannot resolve them without a network call, so they name no vendor.
  ...host("bit.ly", "tinyurl.com", "goo.gl", "ow.ly", "t.co", "lnk.bio", "linktr.ee", "fshb.kr"),
  /\.(?:pdf|jpe?g|png|gif|webp|docx?|xlsx?)(?:[?#]|$)/i,
];

/** Wrappers that hide the real booking link inside a query parameter. */
const WRAPPERS: { test: RegExp; param: string }[] = [
  { test: /^https?:\/\/(?:[a-z0-9-]+\.)*google\.[a-z.]+\/url\b/i, param: "q" },
  { test: /^https?:\/\/(?:[a-z0-9-]+\.)*safelinks\.protection\.outlook\.com\//i, param: "url" },
  { test: /^https?:\/\/(?:[a-z0-9-]+\.)*l\.facebook\.com\/l\.php/i, param: "u" },
];

/* ---------- the registry ---------- */

export const VENDORS: Vendor[] = [
  /* ===== tour & activity reservation systems ===== */
  {
    id: "fareharbor",
    label: "FareHarbor",
    kind: "tours",
    match: [...host("fareharbor.com")],
    html: [...inHtml("fareharbor.com"), /fareharbor\.com\/embeds\//i, /FH\.open\s*\(/],
    caps: caps({ catalog: true }),
    note:
      "Catalog PROVEN: GET https://fareharbor.com/api/v1/companies/<shortname>/ and .../items/ return the company profile and every listed item with name, price, duration, description and photos, unauthenticated (src/enrich/widgets.ts readFareharbor). Availability NOT yet proven: the widget calls .../api/v1/companies/<shortname>/items/<pk>/minimal/availabilities/date/<YYYY-MM-DD>/ in the same unauthenticated family, probe it before claiming it. Booking needs the FareHarbor partner/affiliate API (keyed).",
  },
  {
    id: "peek",
    label: "Peek Pro",
    kind: "tours",
    match: [...host("peek.com", "peekpro.com")],
    // book.peek.com/s/<key>/<code> and the same link under www.peek.com/s/.
    html: [...inHtml("peek.com", "peekpro.com"), /(?:book|www)\.peek\.com\/s\//i],
    caps: caps({ catalog: true, availability: true }),
    note:
      "Catalog and availability PROVEN: GET https://book.peek.com/services/api/programs/<code> with 'Authorization: Key <uuid from the booking URL>' returns the program, its tickets and prices; GET https://book.peek.com/services/api/availability-dates?activity-id=..&start-date=..&end-date=..&tickets[0][ticket-id]=..&tickets[0][quantity]=1 returns priced open dates. The key is the public widget key embedded in the operator's own link, not a partner credential (src/enrich/widgets.ts readPeek, peekLowestFromAvailability). Booking needs Peek's partner API.",
  },
  {
    id: "xola",
    label: "Xola",
    kind: "tours",
    match: [...host("xola.com", "xola.app")],
    // checkout.xola.com/#seller/<id>, the x2-checkout.xola.app/flows/...?button=<id> flow, and the embed's data attributes.
    html: [...inHtml("xola.com", "xola.app"), /xola\.com\/checkout\.js/i, /xola\.app\/flows\//i, /data-seller=/i, /data-button(?:-id)?=["'][a-f0-9]{24}/i],
    caps: caps({ catalog: true }),
    note:
      "Catalog PROVEN: GET https://xola.com/api/experiences?seller=<24-hex seller id>&limit=100 returns published experiences with prices, durations, photos and policies, unauthenticated (src/enrich/widgets.ts readXola). Availability NOT proven: Xola documents /api/experiences/<id>/availability but we have not confirmed it answers without an API key, probe it. Booking is partner-only.",
  },
  {
    id: "rezdy",
    label: "Rezdy",
    kind: "tours",
    match: [...host("rezdy.com")],
    html: [...inHtml("rezdy.com"), /rezdy\.com\/pluginJs/i],
    caps: caps({ partner: true }),
    note: "Rezdy has a full product/availability/booking REST API, but every call needs an apiKey issued to a signed distributor (Rezdy Channel Manager) agreement. The <shortname>.rezdy.com storefront is server-rendered HTML only.",
  },
  {
    id: "checkfront",
    label: "Checkfront",
    kind: "tours",
    // <account>.checkfront.com and the newer <account>.checkfront.site storefront.
    match: [...host("checkfront.com", "checkfront.site")],
    html: [...inHtml("checkfront.com", "checkfront.site"), /checkfront\.(?:com|site)\/lib\/js/i],
    caps: caps({ partner: true }),
    note: "Checkfront's API lives at https://<account>.checkfront.com/api/3.0/item and /item/<id>/cal, but it requires an API token created inside the operator's own account. Nothing public.",
  },
  {
    id: "bokun",
    label: "Bokun",
    kind: "tours",
    match: [...host("bokun.io", "bokundev.io", "bokun.me")],
    html: [...inHtml("bokun.io", "widgets.bokun.io")],
    caps: caps({ partner: true }),
    note: "Bokun (Tripadvisor) API is HMAC-signed with a per-vendor access key. Marketplace access needs a Bokun partner contract.",
  },
  {
    id: "rezgo",
    label: "Rezgo",
    kind: "tours",
    match: [...host("rezgo.com")],
    html: inHtml("rezgo.com"),
    caps: caps({ partner: true }),
    note: "Rezgo's XML/JSON API needs a per-company API key. The <company>.rezgo.com storefront is HTML.",
  },
  {
    id: "zaui",
    label: "Zaui",
    kind: "tours",
    match: [...host("zaui.net", "zaui.com")],
    html: inHtml("zaui.net"),
    caps: caps({ partner: true }),
    note: "Zaui exposes a SOAP/REST partner API keyed per supplier. No public catalog endpoint.",
  },
  {
    id: "tripworks",
    label: "TripWorks",
    kind: "tours",
    match: [...host("tripworks.com")],
    html: [...inHtml("tripworks.com"), /tripworks\.com\/widget\//i],
    caps: caps({}),
    note: "Per-operator subdomain with a /widget/<uuid> embed. The widget is a JS app talking to an internal API we have not mapped; treat the embed JSON as a candidate to probe, nothing claimed.",
  },
  {
    id: "starboard",
    label: "Starboard Suite",
    kind: "tours",
    match: [...host("starboardsuite.com")],
    html: inHtml("starboardsuite.com"),
    caps: caps({}),
    note: "Per-operator subdomain, server-rendered booking pages. Trip times and prices are in the HTML, so a scrape is feasible, but there is no documented public API.",
  },
  {
    id: "waverez",
    label: "WaveRez",
    kind: "tours",
    match: [...host("waverez.com")],
    html: inHtml("waverez.com"),
    caps: caps({}),
    note: "reservations.waverez.com/<operator>. Rental/charter system, no documented public API.",
  },
  {
    id: "bookeo",
    label: "Bookeo",
    kind: "tours",
    match: [...host("bookeo.com")],
    html: [...inHtml("bookeo.com"), /bookeo\.com\/bookeo\/b_[a-z0-9_]+_widget/i, /bookeo\.com\/widget\.js\?a=/i],
    caps: caps({ partner: true }),
    note: "Bookeo's API (https://api.bookeo.com/v2/) needs both an apiKey and a per-account secretKey. The bookeo.com/<account> page is a JS widget.",
  },
  {
    id: "resova",
    label: "Resova",
    kind: "tours",
    match: [...host("resova.us", "resova.com", "resova.eu")],
    html: inHtml("resova.us", "resova.com"),
    caps: caps({ partner: true }),
    note: "Resova has a REST API behind a per-business API key.",
  },
  {
    id: "burblesoft",
    label: "Burble (Burblesoft)",
    kind: "tours",
    match: [...host("burblesoft.com")],
    html: inHtml("burblesoft.com"),
    caps: caps({}),
    note: "Skydiving manifest system. bookings.burblesoft.com/index/<dropzone id>/<n> is server-rendered; no public API known.",
  },
  {
    id: "vallypro",
    label: "Vally (VallyPro)",
    kind: "tours",
    match: [...host("vallypro.com")],
    html: inHtml("vallypro.com"),
    caps: caps({}),
    note: "book.vallypro.com/p/<slug>. Guide and charter booking; no documented public API.",
  },
  {
    id: "areservation",
    label: "aReservation (Indexic)",
    kind: "tours",
    match: [...host("areservation.com", "indexic.net")],
    html: inHtml("areservation.com", "indexic.net"),
    caps: caps({}),
    note: "link.areservation.com/event/<operator>. No public API documented.",
  },
  {
    id: "singenuity",
    label: "Singenuity",
    kind: "tours",
    match: [...host("singenuity.com")],
    html: inHtml("singenuity.com"),
    caps: caps({}),
    note: "book.singenuity.com/<id>/activity/details/<id>/rates. Rates page is server-rendered; no public API known.",
  },
  {
    id: "trytn",
    label: "Trytn",
    kind: "tours",
    match: [...host("trytn.com")],
    html: inHtml("trytn.com"),
    caps: caps({}),
  },
  {
    id: "zenbooker",
    label: "Zenbooker",
    kind: "tours",
    match: [...host("zenbooker.com")],
    html: inHtml("zenbooker.com"),
    caps: caps({}),
  },
  {
    id: "captainbook",
    label: "CaptainBook",
    kind: "tours",
    match: [...host("captainbook.io")],
    html: inHtml("captainbook.io"),
    caps: caps({}),
    note: "<operator>.captainbook.io/en/embedded/folders/<id>/products. Embedded widget, API undocumented.",
  },
  {
    id: "ponorez",
    label: "PONO Rez",
    kind: "tours",
    match: [...host("ponorez.com", "ponorez.online")],
    html: inHtml("ponorez.com"),
    caps: caps({}),
    note: "Hawaii activity reservations. No public API.",
  },
  {
    id: "attractionsuite",
    label: "Attraction Suite",
    kind: "activities",
    match: [...host("attractionsuite.com")],
    html: inHtml("attractionsuite.com"),
    caps: caps({}),
  },
  {
    id: "rezflow",
    label: "RezFlow",
    kind: "tours",
    match: [...host("rezflow.com")],
    html: inHtml("rezflow.com"),
    caps: caps({}),
  },
  {
    id: "bookingcentral",
    label: "Booking Central",
    kind: "tours",
    match: [...host("bookingcentral.com")],
    html: inHtml("bookingcentral.com"),
    caps: caps({}),
  },
  {
    id: "bookingterminal",
    label: "Booking Terminal",
    kind: "tours",
    match: [...host("bookingterminal.com")],
    html: inHtml("bookingterminal.com"),
    caps: caps({}),
  },
  {
    id: "smartrez",
    label: "SmartRez",
    kind: "tours",
    match: [...host("smartrezbooking.com")],
    html: inHtml("smartrezbooking.com"),
    caps: caps({}),
  },
  {
    id: "theflybook",
    label: "The Flybook",
    kind: "tours",
    match: [...host("theflybook.com")],
    html: inHtml("theflybook.com"),
    caps: caps({ partner: true }),
    note: "The Flybook publishes an API to its own customers with a per-account key.",
  },
  {
    id: "dizio",
    label: "Dizio",
    kind: "tours",
    match: [...host("dizio.app")],
    html: inHtml("dizio.app"),
    caps: caps({}),
    note: "Ski/snow and activity reservations, <resort>.reservations.dizio.app.",
  },
  {
    id: "easydz",
    label: "EasyDZ",
    kind: "tours",
    match: [...host("easydz.app")],
    html: inHtml("easydz.app"),
    caps: caps({}),
    note: "Skydiving dropzone manifest and booking.",
  },
  {
    id: "recreogo",
    label: "RecreoGo",
    kind: "activities",
    match: [...host("recreogo.com")],
    html: inHtml("recreogo.com"),
    caps: caps({}),
  },
  {
    id: "offthecouch",
    label: "Off the Couch",
    kind: "activities",
    match: [...host("offthecouch.io")],
    html: inHtml("offthecouch.io"),
    caps: caps({}),
  },
  {
    id: "letsbook",
    label: "LetsBook",
    kind: "activities",
    match: [...host("letsbook.app")],
    html: inHtml("letsbook.app"),
    caps: caps({}),
  },
  {
    id: "rideone",
    label: "RideOne",
    kind: "activities",
    match: [...host("rideone.io")],
    html: inHtml("rideone.io"),
    caps: caps({}),
  },
  {
    id: "vantora",
    label: "Vantora",
    kind: "activities",
    match: [...host("vantora.com")],
    html: inHtml("vantora.com"),
    caps: caps({}),
  },

  /* ===== boat, marina and fleet rental ===== */
  {
    id: "stellarims",
    label: "Stellar IMS",
    kind: "activities",
    match: [...host("stellarims.com")],
    html: inHtml("stellarims.com"),
    caps: caps({}),
    note: "<operator>.stellarims.com. Marina and boat rental management; no public API.",
  },
  {
    id: "boatclubapp",
    label: "Boat Club App",
    kind: "activities",
    match: [...host("boatclubapp.com")],
    html: inHtml("boatclubapp.com"),
    caps: caps({}),
  },
  {
    id: "rentaltide",
    label: "RentalTide",
    kind: "activities",
    match: [...host("rentaltide.com")],
    html: inHtml("rentaltide.com"),
    caps: caps({}),
  },
  {
    id: "booqable",
    label: "Booqable",
    kind: "activities",
    match: [...host("booqable.com", "booqable.store")],
    html: inHtml("booqable.com", "booqable.store"),
    caps: caps({ partner: true }),
    note: "Booqable has a REST API keyed per company.",
  },
  {
    id: "dockwa",
    label: "Dockwa",
    kind: "activities",
    match: [...host("dockwa.com")],
    html: inHtml("dockwa.com"),
    caps: caps({}),
    note: "Marina slip reservations. Listing site as much as software.",
  },
  {
    id: "fishingreservations",
    label: "Fishing Reservations",
    kind: "tours",
    match: [...host("fishingreservations.net", "fishingreservations.com")],
    html: inHtml("fishingreservations.net", "fishingreservations.com"),
    caps: caps({}),
    note: "<landing>.fishingreservations.net/sales/. Sportfishing landing reservations; server-rendered trip lists.",
  },

  /* ===== entertainment venues ===== */
  {
    id: "roller",
    label: "ROLLER",
    kind: "activities",
    match: [...host("roller.app", "rollerdigital.com")],
    html: inHtml("roller.app"),
    caps: caps({ partner: true }),
    note: "ROLLER has a Venue API behind a per-venue key.",
  },
  {
    id: "centeredge",
    label: "CenterEdge",
    kind: "activities",
    match: [...host("centeredgeonline.com", "centeredgesoftware.com")],
    html: inHtml("centeredgeonline.com"),
    caps: caps({}),
  },
  {
    id: "clubspeed",
    label: "Clubspeed",
    kind: "activities",
    match: [...host("clubspeed.com", "clubspeedtiming.com")],
    html: inHtml("clubspeed.com"),
    caps: caps({}),
    note: "Karting and family entertainment. Clubspeed exposes per-venue endpoints to its own customers only.",
  },
  {
    id: "racefacer",
    label: "RaceFacer",
    kind: "activities",
    match: [...host("racefacer.com")],
    html: inHtml("racefacer.com"),
    caps: caps({}),
  },
  {
    id: "alleytrak",
    label: "AlleyTrak",
    kind: "activities",
    match: [...host("alleytrak.com")],
    html: inHtml("alleytrak.com"),
    caps: caps({}),
    note: "Bowling centre management.",
  },
  {
    id: "bowlingpassport",
    label: "Bowling Passport",
    kind: "activities",
    match: [...host("mybowlingpassport.com")],
    html: inHtml("mybowlingpassport.com"),
    caps: caps({}),
  },
  {
    id: "meriq",
    label: "Meriq",
    kind: "activities",
    match: [...host("meriq.com")],
    html: inHtml("meriq.com"),
    caps: caps({}),
  },
  {
    id: "rockgympro",
    label: "Rock Gym Pro",
    kind: "fitness",
    match: [...host("rockgympro.com")],
    html: inHtml("rockgympro.com"),
    caps: caps({}),
    note: "Climbing gym management; app.rockgympro.com/b/?bo=<uuid> booking widget.",
  },
  {
    id: "partywirks",
    label: "PartyWirks",
    kind: "activities",
    match: [...host("partywirks.com")],
    html: inHtml("partywirks.com"),
    caps: caps({}),
  },
  {
    id: "spotapps",
    label: "SpotOn",
    kind: "restaurant",
    match: [...host("spotapps.co", "spoton.com")],
    html: inHtml("spotapps.co"),
    caps: caps({}),
  },

  /* ===== golf ===== */
  {
    id: "teeitup",
    label: "Tee It Up (GolfBack)",
    kind: "golf",
    match: [...host("teeitup.com", "teeitup.golf")],
    html: inHtml("teeitup.com", "teeitup.golf"),
    caps: caps({}),
    note: "<course>.book.teeitup.com is a JS app fed by an internal JSON tee-sheet API. Likely readable without credentials but unprobed, set to true only after a probe.",
  },
  {
    id: "foreup",
    label: "foreUP",
    kind: "golf",
    match: [...host("foreupsoftware.com")],
    html: inHtml("foreupsoftware.com"),
    caps: caps({}),
    note: "foreupsoftware.com/index.php/booking/<course>/<sheet>#teetimes. The tee sheet is fetched by the page from an internal endpoint; unprobed.",
  },
  {
    id: "ezlinks",
    label: "EZLinks",
    kind: "golf",
    match: [...host("ezlinksgolf.com")],
    html: inHtml("ezlinksgolf.com"),
    caps: caps({}),
  },
  {
    id: "chronogolf",
    label: "Chronogolf (Lightspeed Golf)",
    kind: "golf",
    match: [...host("chronogolf.com", "chronogolf.ca")],
    html: inHtml("chronogolf.com"),
    caps: caps({}),
    note: "Chronogolf's widget calls a public-looking /marketplace/clubs/<id>/teetimes JSON. Unprobed.",
  },
  {
    id: "teesnap",
    label: "Teesnap",
    kind: "golf",
    match: [...host("teesnap.net", "teesnap.com")],
    html: inHtml("teesnap.net"),
    caps: caps({}),
  },
  {
    id: "cpsgolf",
    label: "CPS Golf (Club Prophet)",
    kind: "golf",
    match: [...host("cps.golf")],
    html: inHtml("cps.golf"),
    caps: caps({}),
  },
  {
    id: "golfnow",
    label: "GolfNow",
    kind: "marketplace",
    match: [...host("golfnow.com", "golfnow.ca")],
    html: inHtml("golfnow.com"),
    caps: caps({ partner: true }),
    note: "THIRD-PARTY LISTING, not the course's own software. GolfNow's tee-time API is an affiliate product.",
  },
  {
    id: "teeon",
    label: "Tee-On",
    kind: "golf",
    match: [...host("tee-on.com")],
    html: inHtml("tee-on.com"),
    caps: caps({}),
  },
  {
    id: "totale",
    label: "Total-e Integrated",
    kind: "golf",
    match: [...host("totaleintegrated.net", "totaleintegrated.com")],
    html: inHtml("totaleintegrated.net", "totaleintegrated.com"),
    caps: caps({}),
  },
  {
    id: "membersports",
    label: "MemberSports",
    kind: "golf",
    match: [...host("membersports.com")],
    html: inHtml("membersports.com"),
    caps: caps({}),
  },
  {
    id: "whoosh",
    label: "Whoosh",
    kind: "golf",
    match: [...host("whoosh.io")],
    html: inHtml("whoosh.io"),
    caps: caps({}),
  },
  {
    id: "forestpreservegolf",
    label: "Forest Preserve Golf",
    kind: "golf",
    match: [...host("forestpreservegolf.com")],
    html: inHtml("forestpreservegolf.com"),
    caps: caps({}),
    note: "White-labelled municipal tee sheet.",
  },
  {
    id: "golfaccess",
    label: "Access Golf",
    kind: "golf",
    match: [...host("golfwithaccess.com")],
    html: inHtml("golfwithaccess.com"),
    caps: caps({}),
  },
  {
    id: "troon",
    label: "Troon",
    kind: "golf",
    match: [...host("troon.com")],
    html: inHtml("troon.com"),
    caps: caps({}),
    note: "Management company portal, not standalone software; the underlying tee sheet varies by course.",
  },
  {
    id: "arcisgolf",
    label: "Arcis Golf",
    kind: "golf",
    match: [...host("arcisgolf.com")],
    html: inHtml("arcisgolf.com"),
    caps: caps({}),
    note: "Management company portal, not standalone software.",
  },
  {
    id: "invitedclubs",
    label: "Invited (ClubCorp)",
    kind: "golf",
    match: [...host("invitedclubs.com", "clubcorp.com")],
    html: inHtml("invitedclubs.com"),
    caps: caps({}),
    note: "Private club group portal; most pages are membership enquiry, not public tee times.",
  },

  /* ===== fitness, studios, classes ===== */
  {
    id: "mindbody",
    label: "Mindbody",
    kind: "fitness",
    match: [...host("mindbodyonline.com", "mindbody.io", "mindbodyonline.co.uk")],
    html: [...inHtml("mindbodyonline.com", "mindbody.io"), /healcode|mindbody-widget|data-widget-partner/i],
    caps: caps({ partner: true }),
    note: "Mindbody's Public API needs an API key plus per-site activation by the studio. The Healcode/Branded Web widgets render server-side HTML that could be scraped, but nothing is public by contract.",
  },
  {
    id: "vagaro",
    label: "Vagaro",
    kind: "wellness",
    match: [...host("vagaro.com")],
    html: inHtml("vagaro.com"),
    caps: caps({ partner: true }),
    note: "Vagaro's API is merchant-keyed. vagaro.com/<slug> pages are public HTML with the service menu.",
  },
  {
    id: "zenoti",
    label: "Zenoti",
    kind: "wellness",
    match: [...host("zenoti.com")],
    html: inHtml("zenoti.com"),
    caps: caps({ partner: true }),
    note: "Zenoti API needs a per-tenant API key.",
  },
  {
    id: "booker",
    label: "Booker (Mindbody)",
    kind: "wellness",
    match: [...host("booker.com", "secure-booker.com")],
    html: inHtml("booker.com"),
    caps: caps({ partner: true }),
  },
  {
    id: "fresha",
    label: "Fresha",
    kind: "wellness",
    match: [...host("fresha.com")],
    html: inHtml("fresha.com"),
    caps: caps({}),
    note: "fresha.com/a/<slug> is a public marketplace-style profile page with the full service menu and prices in the HTML; scrapeable, but there is no documented public API.",
  },
  {
    id: "janeapp",
    label: "Jane",
    kind: "wellness",
    match: [...host("janeapp.com", "janeapp.ca")],
    html: inHtml("janeapp.com"),
    caps: caps({}),
    note: "<clinic>.janeapp.com. Clinic booking; the SPA reads internal JSON. Unprobed.",
  },
  {
    id: "massagebook",
    label: "MassageBook",
    kind: "wellness",
    match: [...host("massagebook.com")],
    html: inHtml("massagebook.com"),
    caps: caps({}),
    note: "massagebook.com/biz/<name> is a public profile with the service menu in the HTML.",
  },
  {
    id: "mangomint",
    label: "Mangomint",
    kind: "wellness",
    match: [...host("mangomint.com")],
    html: inHtml("mangomint.com"),
    caps: caps({}),
  },
  {
    id: "glossgenius",
    label: "GlossGenius",
    kind: "wellness",
    match: [...host("glossgenius.com")],
    html: inHtml("glossgenius.com"),
    caps: caps({}),
  },
  {
    id: "clinicsense",
    label: "ClinicSense",
    kind: "wellness",
    match: [...host("clinicsense.com")],
    html: inHtml("clinicsense.com"),
    caps: caps({}),
  },
  {
    id: "cojilio",
    label: "Cojilio",
    kind: "wellness",
    match: [...host("cojilio.com")],
    html: inHtml("cojilio.com"),
    caps: caps({}),
  },
  {
    id: "chronos",
    label: "Chronos",
    kind: "wellness",
    match: [...host("bychronos.com")],
    html: inHtml("bychronos.com"),
    caps: caps({}),
  },
  {
    id: "handandstone",
    label: "Hand & Stone",
    kind: "wellness",
    match: [...host("handandstone.com", "handandstone.ca")],
    html: inHtml("handandstone.com"),
    caps: caps({}),
    note: "Franchise brand portal (the underlying engine is Zenoti/Booker per location), not standalone software.",
  },
  {
    id: "yogasix",
    label: "YogaSix",
    kind: "fitness",
    match: [...host("yogasix.com")],
    html: inHtml("yogasix.com"),
    caps: caps({}),
    note: "Xponential franchise brand portal, Mindbody underneath.",
  },
  {
    id: "iclasspro",
    label: "iClassPro",
    kind: "fitness",
    match: [...host("iclasspro.com")],
    html: inHtml("iclasspro.com"),
    caps: caps({}),
  },
  {
    id: "hisawyer",
    label: "HiSawyer",
    kind: "fitness",
    match: [...host("hisawyer.com")],
    html: inHtml("hisawyer.com"),
    caps: caps({}),
  },
  {
    id: "daysmart",
    label: "DaySmart Recreation",
    kind: "fitness",
    match: [...host("daysmartrecreation.com", "daysmart.com")],
    html: inHtml("daysmartrecreation.com"),
    caps: caps({}),
    note: "Rinks and rec facilities.",
  },
  {
    id: "courtreserve",
    label: "CourtReserve",
    kind: "fitness",
    match: [...host("courtreserve.com")],
    html: inHtml("courtreserve.com"),
    caps: caps({}),
  },
  {
    id: "ezfacility",
    label: "EZFacility",
    kind: "fitness",
    match: [...host("ezfacility.com")],
    html: inHtml("ezfacility.com"),
    caps: caps({}),
  },
  {
    id: "finnly",
    label: "Finnly Connect",
    kind: "fitness",
    match: [...host("finnlyconnect.com")],
    html: inHtml("finnlyconnect.com"),
    caps: caps({}),
  },
  {
    id: "uschedule",
    label: "uSchedule",
    kind: "fitness",
    match: [...host("uschedule.com")],
    html: inHtml("uschedule.com"),
    caps: caps({}),
  },
  {
    id: "schedulista",
    label: "Schedulista",
    kind: "scheduler",
    match: [...host("schedulista.com")],
    html: inHtml("schedulista.com"),
    caps: caps({}),
  },
  {
    id: "schedulepointe",
    label: "SchedulePointe",
    kind: "scheduler",
    match: [...host("schedulepointe.com")],
    html: inHtml("schedulepointe.com"),
    caps: caps({}),
  },

  /* ===== aviation ===== */
  {
    id: "flightschedulepro",
    label: "Flight Schedule Pro",
    kind: "activities",
    match: [...host("flightschedulepro.com")],
    html: inHtml("flightschedulepro.com"),
    caps: caps({ partner: true }),
    note: "Flight school aircraft/instructor scheduling. API is account-keyed and the calendar is behind a login.",
  },
  {
    id: "flightbridge",
    label: "FlightBridge",
    kind: "activities",
    match: [...host("flightbridge.com")],
    html: inHtml("flightbridge.com"),
    caps: caps({}),
  },

  /* ===== generic schedulers and commerce ===== */
  {
    id: "acuity",
    label: "Acuity Scheduling / Squarespace Scheduling",
    kind: "scheduler",
    match: [...host("acuityscheduling.com", "squarespacescheduling.com", "as.me")],
    html: [...inHtml("acuityscheduling.com", "squarespacescheduling.com", "as.me"), /embed\.acuityscheduling\.com/i],
    caps: caps({ partner: true }),
    note: "Acuity's API needs the owner's API key or an OAuth grant. The public schedule page renders open slots as HTML, so a scrape is possible; no endpoint claimed.",
  },
  {
    id: "calendly",
    label: "Calendly",
    kind: "scheduler",
    match: [...host("calendly.com")],
    html: [...inHtml("calendly.com"), /assets\.calendly\.com\/assets\/external\/widget/i],
    caps: caps({ partner: true }),
    note: "Calendly's v2 API is OAuth/PAT only. The booking page fetches open slots from /api/booking/event_types/<uuid>/calendar/range?timezone=..&range_start=..&range_end=.. without a token, a strong availability candidate, unprobed, so left false.",
  },
  {
    id: "square",
    label: "Square Appointments",
    kind: "scheduler",
    match: [
      ...host("square.site", "squareup.com", "square.link"),
      hostPath("squareup.com", "/appointments"),
    ],
    html: [...inHtml("square.site", "squareup.com"), /squareup\.com\/appointments/i],
    caps: caps({ partner: true }),
    note: "Square's Bookings API (catalog, availability search, create booking) is complete but needs the seller's OAuth grant. Square Online site HTML does carry the service list.",
  },
  {
    id: "setmore",
    label: "Setmore",
    kind: "scheduler",
    match: [...host("setmore.com")],
    html: inHtml("setmore.com"),
    caps: caps({ partner: true }),
  },
  {
    id: "supersaas",
    label: "SuperSaaS",
    kind: "scheduler",
    match: [...host("supersaas.com")],
    html: inHtml("supersaas.com"),
    caps: caps({ partner: true }),
    note: "SuperSaaS schedules can be public; its API needs an account password/key.",
  },
  {
    id: "googlecalendar",
    label: "Google Calendar appointment schedule",
    kind: "scheduler",
    match: [...host("calendar.app.google"), hostPath("calendar.google.com", "/calendar/[^\"']*appointments")],
    caps: caps({}),
    note: "A personal appointment page, not booking software. Treat as 'no real system'.",
  },
  {
    id: "outlookbookings",
    label: "Microsoft Bookings",
    kind: "scheduler",
    match: [hostPath("outlook.office.com", "/book"), hostPath("outlook.office365.com", "/owa/calendar")],
    caps: caps({}),
  },
  {
    id: "hubspotmeetings",
    label: "HubSpot Meetings",
    kind: "scheduler",
    match: [...host("meetings.hubspot.com")],
    html: inHtml("meetings.hubspot.com"),
    caps: caps({}),
  },
  {
    id: "form",
    label: "Web form (JotForm, Google Forms, Office Forms)",
    kind: "other",
    match: [
      ...host("jotform.com", "jotform.co"),
      hostPath("docs.google.com", "/forms"),
      hostPath("forms.office.com", "/"),
      ...host("forms.gle", "wufoo.com", "typeform.com", "formstack.com"),
    ],
    caps: caps({}),
    note: "A request form, not a booking system. Nothing to read, and a strong outreach signal: this operator has no live inventory anywhere.",
  },

  /* ===== restaurants, bars, tasting rooms ===== */
  {
    id: "opentable",
    label: "OpenTable",
    kind: "restaurant",
    match: [...host("opentable.com", "opentable.ca", "opentable.co.uk", "otrestaurant.com")],
    html: [...inHtml("opentable.com"), /opentable\.com\/widget\/reservation/i],
    caps: caps({ partner: true }),
    note: "THIRD-PARTY LISTING. OpenTable's availability and booking API is an affiliate/partner product.",
  },
  {
    id: "resy",
    label: "Resy",
    kind: "restaurant",
    match: [...host("resy.com")],
    html: inHtml("resy.com"),
    caps: caps({ partner: true }),
    note: "THIRD-PARTY LISTING. Resy's api.resy.com/4/find needs an api_key header issued to partners.",
  },
  {
    id: "tock",
    label: "Tock",
    kind: "restaurant",
    match: [...host("exploretock.com", "tockhq.com")],
    html: inHtml("exploretock.com"),
    caps: caps({ partner: true }),
    note: "THIRD-PARTY LISTING (also the venue's own system for many wineries).",
  },
  {
    id: "toast",
    label: "Toast",
    kind: "restaurant",
    match: [...host("toasttab.com", "toastab.com")],
    html: inHtml("toasttab.com"),
    caps: caps({ partner: true }),
    note: "Toast's Partner API needs a restaurant-authorised integration. Online-ordering menus at order.toasttab.com are public HTML/JSON but are food, not bookable experiences.",
  },
  {
    id: "sevenrooms",
    label: "SevenRooms",
    kind: "restaurant",
    match: [...host("sevenrooms.com")],
    html: inHtml("sevenrooms.com"),
    caps: caps({ partner: true }),
  },
  {
    id: "libroreserve",
    label: "Libro Reserve",
    kind: "restaurant",
    match: [...host("libroreserve.com")],
    html: inHtml("libroreserve.com"),
    caps: caps({}),
  },
  {
    id: "tableagent",
    label: "TableAgent",
    kind: "restaurant",
    match: [...host("tableagent.com")],
    html: inHtml("tableagent.com"),
    caps: caps({}),
  },
  {
    id: "tripleseat",
    label: "Tripleseat",
    kind: "restaurant",
    match: [...host("tripleseat.com")],
    html: inHtml("tripleseat.com"),
    caps: caps({}),
    note: "Private-event enquiry forms, not open inventory.",
  },
  {
    id: "perfectvenue",
    label: "Perfect Venue",
    kind: "restaurant",
    match: [...host("perfectvenue.com")],
    html: inHtml("perfectvenue.com"),
    caps: caps({}),
    note: "Private-event enquiry forms.",
  },
  {
    id: "orderport",
    label: "OrderPort",
    kind: "restaurant",
    match: [...host("orderport.net")],
    html: inHtml("orderport.net"),
    caps: caps({}),
    note: "Winery ecommerce and tasting reservations.",
  },

  /* ===== ticketing ===== */
  {
    id: "eventbrite",
    label: "Eventbrite",
    kind: "marketplace",
    match: [...host("eventbrite.com", "eventbrite.ca", "eventbrite.co.uk", "evbuc.com")],
    html: [...inHtml("eventbrite.com"), /eventbrite\.com\/static\/widgets/i],
    caps: caps({ partner: true }),
    note: "THIRD-PARTY LISTING. Eventbrite's API is OAuth-token based; a token can be self-issued for public search, but event data belongs to the organiser's account. Dated one-off events, not recurring inventory.",
  },
  {
    id: "simpletix",
    label: "SimpleTix",
    kind: "marketplace",
    match: [...host("simpletix.com")],
    html: inHtml("simpletix.com"),
    caps: caps({}),
  },
  {
    id: "accesso",
    label: "accesso",
    kind: "activities",
    match: [...host("accessoticketing.com", "accesso.com")],
    html: inHtml("accessoticketing.com"),
    caps: caps({ partner: true }),
    note: "Attraction ticketing for large parks; partner-gated.",
  },
  {
    id: "ordersecuretickets",
    label: "Order Secure Tickets",
    kind: "activities",
    match: [...host("ordersecuretickets.com")],
    html: inHtml("ordersecuretickets.com"),
    caps: caps({}),
  },

  /* ===== third-party marketplaces (NOT the operator's own software) ===== */
  {
    id: "viator",
    label: "Viator",
    kind: "marketplace",
    match: [...host("viator.com")],
    html: inHtml("viator.com"),
    caps: caps({ partner: true }),
    note: "THIRD-PARTY LISTING. Viator's Partner API (products, availability, booking) requires a signed affiliate or merchant partner agreement. A viator.com link tells us the operator sells through Viator; it does not tell us what software runs their own calendar.",
  },
  {
    id: "getyourguide",
    label: "GetYourGuide",
    kind: "marketplace",
    match: [...host("getyourguide.com", "gyg.me")],
    html: inHtml("getyourguide.com"),
    caps: caps({ partner: true }),
    note: "THIRD-PARTY LISTING. Partner API is contract-gated.",
  },
  {
    id: "fishingbooker",
    label: "FishingBooker",
    kind: "marketplace",
    match: [...host("fishingbooker.com")],
    html: inHtml("fishingbooker.com"),
    caps: caps({ partner: true }),
    note: "THIRD-PARTY LISTING for charters. Public listing pages carry trips, prices and a calendar in the HTML; no open API.",
  },
  {
    id: "anycreek",
    label: "AnyCreek",
    kind: "marketplace",
    match: [...host("anycreek.com")],
    html: inHtml("anycreek.com"),
    caps: caps({}),
    note: "THIRD-PARTY LISTING for guided outdoor trips.",
  },
  {
    id: "boatsetter",
    label: "Boatsetter",
    kind: "marketplace",
    match: [...host("boatsetter.com", "getmyboat.com")],
    html: inHtml("boatsetter.com"),
    caps: caps({}),
    note: "THIRD-PARTY LISTING for boat rentals.",
  },
  {
    id: "airbnb",
    label: "Airbnb / Vrbo",
    kind: "marketplace",
    match: [...host("airbnb.com", "airbnb.ca", "vrbo.com")],
    html: inHtml("airbnb.com"),
    caps: caps({}),
    note: "THIRD-PARTY LISTING, mostly lodging.",
  },
  {
    id: "cityexperiences",
    label: "City Experiences (Hornblower)",
    kind: "marketplace",
    match: [...host("cityexperiences.com", "hornblower.com")],
    html: inHtml("cityexperiences.com"),
    caps: caps({}),
    note: "Operator group portal / listing.",
  },
  {
    id: "polarisadventures",
    label: "Polaris Adventures",
    kind: "marketplace",
    match: [hostPath("polaris.com", "/"), ...host("adventures.polaris.com")],
    caps: caps({}),
    note: "THIRD-PARTY LISTING of outfitters.",
  },

  /* ===== lodging, camping, parks and public rec ===== */
  {
    id: "campspot",
    label: "Campspot",
    kind: "other",
    match: [...host("campspot.com")],
    html: inHtml("campspot.com"),
    caps: caps({}),
  },
  {
    id: "reserveamerica",
    label: "ReserveAmerica",
    kind: "other",
    match: [...host("reserveamerica.com", "recreation.gov")],
    html: inHtml("reserveamerica.com"),
    caps: caps({ partner: true }),
    note: "recreation.gov does publish an open RIDB API (api key, free) for facilities; campsite availability is a separate feed. Public-land inventory, not an operator's own software.",
  },
  {
    id: "resnexus",
    label: "ResNexus",
    kind: "other",
    match: [...host("resnexus.com")],
    html: inHtml("resnexus.com"),
    caps: caps({}),
  },
  {
    id: "cloudbeds",
    label: "Cloudbeds",
    kind: "other",
    match: [...host("cloudbeds.com")],
    html: inHtml("cloudbeds.com"),
    caps: caps({ partner: true }),
  },
  {
    id: "synxis",
    label: "SynXis (Sabre)",
    kind: "other",
    match: [...host("synxis.com")],
    html: inHtml("synxis.com"),
    caps: caps({ partner: true }),
  },
  {
    id: "ihotelier",
    label: "iHotelier (Amadeus)",
    kind: "other",
    match: [...host("ihotelier.com")],
    html: inHtml("ihotelier.com"),
    caps: caps({ partner: true }),
  },
  {
    id: "innroad",
    label: "innRoad",
    kind: "other",
    match: [...host("innroad.com")],
    html: inHtml("innroad.com"),
    caps: caps({}),
  },
  {
    id: "webrez",
    label: "WebRez",
    kind: "other",
    match: [...host("webrez.com")],
    html: inHtml("webrez.com"),
    caps: caps({}),
  },
  {
    id: "reservationkey",
    label: "ReservationKey",
    kind: "other",
    match: [...host("reservationkey.com")],
    html: inHtml("reservationkey.com"),
    caps: caps({}),
  },
  {
    id: "rguest",
    label: "rGuest (Agilysys)",
    kind: "other",
    match: [...host("rguest.com")],
    html: inHtml("rguest.com"),
    caps: caps({}),
  },
  {
    id: "activenet",
    label: "ACTIVE Net / CommunityPass",
    kind: "other",
    match: [...host("activecommunities.com", "activenetwork.com", "active.com")],
    html: inHtml("activecommunities.com"),
    caps: caps({}),
    note: "Municipal parks and rec registration.",
  },
  {
    id: "webtrac",
    label: "WebTrac (Vermont Systems)",
    kind: "other",
    match: [...host("myvscloud.com")],
    html: inHtml("myvscloud.com"),
    caps: caps({}),
    note: "Municipal parks and rec registration.",
  },
  {
    id: "rec1",
    label: "REC1",
    kind: "other",
    match: [...host("rec1.com")],
    html: inHtml("rec1.com"),
    caps: caps({}),
  },
  {
    id: "govpark",
    label: "Government / park service page",
    kind: "other",
    match: [
      new RegExp("^https?://(?:[a-z0-9-]+\\.)*[a-z0-9-]+\\.gov(?:[:/?#]|$)", "i"),
      ...host("armymwr.com", "nature.org"),
    ],
    caps: caps({}),
    note: "A public agency page, not operator booking software.",
  },
];

/** Fast lookup by id. */
export const VENDOR_BY_ID: Map<string, Vendor> = new Map(VENDORS.map((v) => [v.id, v]));

/** A marketplace/restaurant listing is somebody else's storefront, not the operator's own system. */
export function isMarketplace(id: VendorId): boolean {
  const v = VENDOR_BY_ID.get(id);
  return !!v && (v.kind === "marketplace" || v.kind === "restaurant");
}

/** True when this id is real booking software the operator runs (excludes marketplaces, forms, gov pages). */
export function isOwnSoftware(id: VendorId): boolean {
  const v = VENDOR_BY_ID.get(id);
  if (!v) return false;
  if (v.kind === "marketplace") return false;
  return !["form", "govpark", "googlecalendar", "airbnb", "polarisadventures", "cityexperiences"].includes(v.id);
}

/* ---------- detection ---------- */

/** Peel Google/Outlook/Facebook redirect wrappers so the real booking host is what we test. */
function unwrap(url: string): string {
  let u = url.trim();
  for (let i = 0; i < 3; i += 1) {
    const w = WRAPPERS.find((x) => x.test.test(u));
    if (!w) break;
    let inner: string | null = null;
    try {
      inner = new URL(u).searchParams.get(w.param);
    } catch {
      inner = null;
    }
    if (!inner || !/^https?:\/\//i.test(inner)) break;
    u = inner;
  }
  return u;
}

/** True for links that are share buttons, files, phone numbers or dead anchors. */
export function isNotBookingLink(url: string): boolean {
  const u = unwrap(url);
  return NOT_BOOKING.some((re) => re.test(u));
}

/**
 * Which booking platform a URL belongs to, or null when it is the operator's own domain,
 * a share link, or a vendor we do not know.
 */
export function detectVendor(url: string): VendorId | null {
  if (!url) return null;
  const u = unwrap(url);
  if (!/^https?:\/\//i.test(u)) return null;
  if (NOT_BOOKING.some((re) => re.test(u))) return null;
  for (const v of VENDORS) {
    for (const re of v.match) if (re.test(u)) return v.id;
  }
  return null;
}

/** Which booking platform a page's HTML embeds, for operators whose booking link we never found. */
export function detectVendorFromHtml(html: string): VendorId | null {
  if (!html) return null;
  const head = html.length > 400_000 ? html.slice(0, 400_000) : html;
  for (const v of VENDORS) {
    for (const re of v.html || []) if (re.test(head)) return v.id;
  }
  return null;
}

/* ---------- per-operator resolution ---------- */

export type VendorMatch = {
  id: VendorId;
  label: string;
  kind: VendorKind;
  caps: VendorCaps;
  bookingUrl: string | null;
  /** True when this is a third-party listing rather than the operator's own booking software. */
  marketplace: boolean;
  note?: string;
};

const FACT_KEYS = new Set(["booking_url", "online_booking", "booking_vendor"]);

/** How good a match is: real software with a reader beats real software beats a listing. */
function rank(v: Vendor): number {
  let s = 0;
  if (isOwnSoftware(v.id)) s += 100;
  if (v.caps.catalog) s += 20;
  if (v.caps.availability) s += 10;
  if (v.caps.partner) s += 2;
  if (v.kind === "scheduler") s -= 5;
  if (v.kind === "other") s -= 10;
  if (v.kind === "marketplace" || v.kind === "restaurant") s -= 20;
  return s;
}

/**
 * The booking platform an operator runs, from their crawled facts.
 * Prefers the operator's own software over a third-party listing when both links exist.
 */
export function vendorFor(
  operatorFacts: { fact_key: string; fact_value: string }[],
): VendorMatch | null {
  let best: { v: Vendor; url: string | null; score: number } | null = null;
  for (const f of operatorFacts) {
    if (!FACT_KEYS.has(f.fact_key) || !f.fact_value) continue;
    let id: VendorId | null = null;
    let url: string | null = null;
    if (f.fact_key === "booking_vendor") {
      // Left by src/enrich/widgets.ts after a successful widget read.
      id = VENDOR_BY_ID.has(f.fact_value) ? f.fact_value : null;
    } else {
      id = detectVendor(f.fact_value);
      url = id ? unwrap(f.fact_value) : null;
    }
    if (!id) continue;
    const v = VENDOR_BY_ID.get(id);
    if (!v) continue;
    const score = rank(v) + (url ? 1 : 0);
    if (!best || score > best.score) best = { v, url, score };
    else if (best.v.id === v.id && !best.url && url) best.url = url;
  }
  if (!best) return null;
  return {
    id: best.v.id,
    label: best.v.label,
    kind: best.v.kind,
    caps: best.v.caps,
    bookingUrl: best.url,
    marketplace: isMarketplace(best.v.id),
    note: best.v.note,
  };
}

/** Short human summary of what we can do with a vendor today. */
export function capsSummary(c: VendorCaps): string {
  const yes = [c.catalog && "catalog", c.availability && "availability", c.book && "book"].filter(Boolean) as string[];
  if (yes.length) return yes.join("+") + (c.partner ? " (more via partner)" : "");
  return c.partner ? "partner deal only" : "none";
}
