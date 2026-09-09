export type CategoryId = "all" | "air" | "water" | "motorsport" | "indoor" | "outdoor";

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
  | "kayak";

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
  per?: string;
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

/** One bookable service with its price variants, grouped for display. optionIdx points into Unclaimed.options. */
export type UnclaimedService = {
  name: string;
  desc: string | null;
  /** A picture of this specific service from the operator's site, when one sits next to it. */
  photo?: string;
  variants: { label: string; price: number | null; per?: string; optionIdx: number }[];
};

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
  waiverUrl?: string;
  hoursText?: string[];
  faq?: { q: string; a: string }[];
  /** True for browse-catalog records that have not fetched their detail file yet. */
  lite?: boolean;
  /** Id of the detail file to fetch when it differs from this record's id (hand-verified seeds). */
  detail?: string;
  /** Card facts carried on lite records: duration as the operator wrote it, and a free-cancellation line when their policy says so. */
  dur?: string;
  fc?: string;
  /** Lowest published price, carried on lite records so cards can show "From $X". */
  from?: number;
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
};

export type TabId = "explore" | "trips" | "inbox" | "account";
export type ScreenId = TabId | "detail" | "confirm" | "chat" | "operator";
export type SheetId = "review" | "request" | "metro" | null;
