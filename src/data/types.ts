export type CategoryId = "all" | "air" | "water" | "motorsport" | "indoor" | "outdoor" | "play" | "food" | "wellness" | "classes" | "culture";

export type ArtKind =
  | "skydive"
  | "heli"
  | "balloon"
  | "kart"
  | "escape"
  | "axe"
  | "paintball"
  | "horse"
  | "jetski"
  | "pontoon"
  | "fishing"
  | "parasail"
  | "cruise"
  | "kayak"
  | "bowling"
  | "minigolf"
  | "arcade"
  | "trampoline"
  | "lasertag"
  | "icerink"
  | "waterpark"
  | "themepark"
  | "zoo"
  | "aquarium"
  | "karaoke"
  | "climbing"
  | "range"
  | "archery"
  | "golf"
  | "zipline"
  | "ski"
  | "bike"
  | "snowmobile"
  | "rafting"
  | "scuba"
  | "surf"
  | "paragliding"
  | "gliding"
  | "brewery"
  | "winery"
  | "distillery"
  | "cooking"
  | "spa"
  | "yoga"
  | "dance"
  | "pottery"
  | "tour"
  | "rage"
  | "theatre"
  | "museum"
  | "garden"
  | "camping"
  | "tennis"
  | "swim"
  | "martialarts"
  | "gymnastics"
  | "fitness"
  | "venue"
  | "sailing"
  | "discgolf"
  | "billiards"
  | "motorsport"
  | "sauna"
  | "paddleboard";

export type PriceUnit = "person" | "hr" | "trip";

export type Addon = {
  id: string;
  name: string;
  note: string;
  price: number;
};

export type Listing = {
  id: string;
  cat: Exclude<CategoryId, "all">;
  art: ArtKind;
  title: string;
  op: string;
  opInit: string;
  opSince: string;
  launch: string;
  dist: string;
  rating: number;
  reviews: number;
  price: number;
  unit: PriceUnit;
  minHours: number;
  qtyLabel: string;
  qtyMax: number;
  qtyUnit: string;
  specs: string[];
  facts: [string, string][];
  blurb: string;
  policy: string[];
  addons: Addon[];
};

export type UnclaimedOption = {
  name: string;
  detail: string;
  price: number | null;
  /** What the price buys, as the operator wrote it: "person", "hour", "cabin", "lane". Free text. */
  per?: string;
  /**
   * Whether to multiply by the party size. Set by the operator, and then it decides; absent on a scraped
   * listing, where perPerson() still has to read the words and guess.
   */
  perGuest?: boolean;
};

/** Public contact facts for one operator, synced from the backend. null means the site did not publish it. */
export type OperatorContact = {
  domain: string;
  website: string | null;
  phone: string | null;
  email: string | null;
  street: string | null;
  city: string | null;
  region: string | null;
  postal: string | null;
  hours: string[];
  bookingVendor: string | null;
  fetchedAt: string | null;
};

/** A word a first-time guest may not know, with one plain sentence saying what it means (backend/src/sync/glossary.ts). */
export type Explained = { term: string; meaning: string };

/** One bookable service with its price variants, grouped for display. optionIdx points into Unclaimed.options. */
export type UnclaimedService = {
  name: string;
  desc: string | null;
  /** A picture of this specific service from the operator's site, when one sits next to it. */
  photo?: string;
  /**
   * Price tiers in plain words. `explain` carries at most two jargon terms the tier's label uses that the service
   * name did not already explain. `moreOptions` marks tiers folded behind a "More options" control: the tail of a run
   * that differs only by size or count, an exact repeat, or anything past the tenth visible tier.
   */
  variants: { label: string; price: number | null; per?: string; optionIdx: number; explain?: Explained[]; moreOptions?: true }[];
  /** At most two jargon terms in the service name, explained ("Bareboat", "Full hookup"). */
  explain?: Explained[];
  /**
   * The largest party this service takes at one start time, as the operator set it. Absent on a scraped listing,
   * where nobody has told us and the picker falls back to a generous default.
   */
  maxGuests?: number;
};

/** A review as the operator republished it. `date` is ISO (YYYY-MM-DD or YYYY-MM); `source` is "site" or the platform the operator's page named. */
export type GuestReview = { author?: string; rating?: number; text: string; date?: string; source?: string };

/** `city` is absent when the crawl found the pin but never its town. Do not fill it in: see `venueLabel`. */
export type OperatorLocation = { city?: string; region?: string; lat: number; lon: number; street?: string };

export type Unclaimed = {
  id: string;
  title: string;
  cat: Exclude<CategoryId, "all">;
  art: ArtKind;
  area: string;
  metroId: string;
  src: string;
  rating?: number;
  reviews?: number;
  specs: string[];
  options: UnclaimedOption[];
  includes: string[];
  gap: string;
  extraNote?: string;
  /** The operator's own description of what they do, in their words. Present after AI enrichment. */
  blurb?: string;
  /** Operator pin, from their listing. Used for distance from the guest. */
  lat?: number;
  lon?: number;
  /** Other places a chain runs from. Distance and the "where" line use whichever is closest to the guest. */
  locations?: OperatorLocation[];
  /** Search-only words: Google's business type and service names. Not shown as facts. */
  tags?: string[];
  /** Optional extras the operator lists with a price, like an additional rider or a photo pack. */
  addons?: UnclaimedOption[];
  /** Services grouped with descriptions, from the operator's own pages. */
  services?: UnclaimedService[];
  /** Photos linked from the operator's own site. cover is the best one. */
  cover?: string;
  photos?: string[];
  /** A short clip or GIF from the operator's own site. Cards and the listing hero play it muted on loop. */
  video?: string;
  /** YouTube or Vimeo embed URL, shown on the listing page. */
  videoEmbed?: string;
  /** The operator's own YouTube videos, most viewed first. */
  ytVideos?: { id: string; title: string; views: number }[];
  /** TikTok and Instagram handles from their site. */
  tiktok?: string;
  instagram?: string;
  /** Viator-shaped detail sections. Every one is optional and only present when the operator's own site states it. */
  highlights?: string[];
  requirements?: string[];
  groupInfo?: string[];
  bring?: string[];
  season?: string;
  meetingPoint?: string;
  checkin?: string;
  cancellation?: string;
  policies?: string[];
  /** The operator's own "what it's actually like" guide; absent means the page shows the kind's default (data/guides.ts). */
  guide?: { steps: string[]; bring: string[]; goodFor: string };
  waiverUrl?: string;
  hoursText?: string[];
  faq?: { q: string; a: string }[];
  /** Reviews the operator publishes on their own site or marks up for search engines. Author and stars when stated. */
  quotes?: GuestReview[];
  /** True for browse-catalog records that have not fetched their detail file yet. */
  lite?: boolean;
  /** No photo, price, hours, services or description yet: real, but nothing a guest can act on, so browse leaves it out. */
  thin?: boolean;
  /** A test listing: reachable by its own link, claimable and bookable, but never in a list, search or rail. */
  unlisted?: boolean;
  /** Nothing in the listing's own text confirms its kind yet, so a kind rail lists it after the confirmed ones. */
  kindUnconfirmed?: boolean;
  /** Id of the detail file to fetch when it differs from this record's id (hand-verified seeds). */
  detail?: string;
  /** SHA-256 of the claim token in the operator's email link. Lets the static site verify a claim link. */
  claimKey?: string;
  /** The operator claimed this listing and runs it through Outset; only then may a guest see "Instant". */
  claimed?: boolean;
  /** Claimed operators can switch instant confirmation on; unclaimed listings are always requests. */
  instant?: boolean;
  /** False when the claimed operator paused bookings in their dashboard: the page shows, nothing can be booked. */
  accepting?: boolean;
  /** The claimed operator switched Published off: the page opens by its own link but says so, and takes no booking. */
  offline?: boolean;
  /**
   * False when the claimed operator switched the assistant off in their dashboard: the listing stops offering
   * Otto and points guests at the shop instead. Absent means on, which is what every unclaimed listing is.
   */
  assistant?: boolean;
  /** Compact week from published hours on lite records: Sunday first, [open, close] in minutes, [0,0] closed, null unknown. */
  hrs?: ([number, number] | null)[];
  /** Card facts carried on lite records: duration as the operator wrote it, and a free-cancellation line when their policy says so. */
  dur?: string;
  fc?: string;
  /** Lowest published price, carried on lite records so cards can show "From $X". */
  from?: number;
  /**
   * Day-specific deals from the operator's own site, at most three, consolidated by backend/src/sync/dealText.ts.
   * days: 0=Sun..6=Sat, empty = every day. start/end "HH:MM". `title` is the short line ("Half-price Tuesdays"),
   * `detail` the operator's most complete sentence (may be empty), `code` a promo code they published, `date` a
   * one-off holiday date ("May 10") shown instead of day chips. `text` is kept for older readers: detail, else title.
   */
  promos?: { text: string; days: number[]; start?: string; end?: string; title?: string; detail?: string; code?: string; date?: string }[];
  /** Compact first deal on lite records: "2|Half-price Tuesdays" (day list, then the deal title), for the card badge. */
  deal?: string;
  /** Contact facts shipped inside the detail file. */
  contact?: OperatorContact;
};

export type Category = {
  id: CategoryId;
  name: string;
  icon: string;
};

export type CategoryMeta = {
  railEyebrow: string;
  railTitle: string;
  head: string;
  search: string;
  note: string;
  emptyTitle: string;
  emptyBody: string;
};

export type ChatRole = "me" | "them" | "sys";

/** What the chat screen needs, whether the thread is a live listing or a catalog operator. */
export type ChatThread = {
  id: string;
  kind: "listing" | "company";
  name: string;
  initials: string;
  line: string;
  suggestions: string[];
};

export type ChatMessage = {
  who: ChatRole;
  t: string;
  at: string;
  pending?: boolean;
};

export type Booking = {
  listing: string;
  date: string;
  slot: string;
  qty: number;
  addons: string[];
  total: number;
  code: string;
  created: number;
  /** Who booked, so the operator can confirm and the guest can be reached. */
  guest?: { name: string; phone: string; email?: string };
  /** Card held or charged through Stripe, as opposed to paid on site. */
  paid?: boolean;
  /**
   * What was booked, as it read at confirm time. `addons` carries the option's index, and the operator's
   * dashboard used to look that index up in the live menu, so deleting or reordering a service relabelled
   * every earlier booking with whatever now sat at that position. Old bookings have none of these.
   */
  service?: string;
  variant?: string;
  price?: number | null;
  per?: string;
};

export type TabId = "explore" | "trips" | "inbox" | "account";
export type ScreenId = TabId | "detail" | "confirm" | "chat" | "operator";
export type SheetId = "review" | "request" | "metro" | null;
