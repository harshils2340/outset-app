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

export type Unclaimed = {
  id: string;
  title: string;
  cat: Exclude<CategoryId, "all">;
  art: ArtKind;
  area: string;
  src: string;
  specs: string[];
  options: UnclaimedOption[];
  includes: string[];
  gap: string;
  extraNote?: string;
};

export type Category = {
  id: CategoryId;
  name: string;
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
};

export type TabId = "explore" | "trips" | "inbox" | "account";
export type ScreenId = TabId | "detail" | "confirm" | "chat";
export type SheetId = "review" | "request" | null;
