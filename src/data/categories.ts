import type { Category, CategoryMeta } from "./types";

export const CATS = [
  { id: "all", name: "All", icon: "catAll" },
  { id: "air", name: "Air", icon: "catAir" },
  { id: "water", name: "Water", icon: "catWater" },
  { id: "motorsport", name: "Race", icon: "catMotorsport" },
  { id: "indoor", name: "Indoor", icon: "catIndoor" },
  { id: "outdoor", name: "Outdoor", icon: "catOutdoor" },
] as Category[];

export const CATMETA = {
  all: {
    railEyebrow: "",
    railTitle: "Near you",
    head: "experiences",
    search: "Kayak, skydive, karting",
    note: "",
    emptyTitle: "No experiences match that",
    emptyBody: "Try another category or a different city.",
  },
  air: {
    railEyebrow: "",
    railTitle: "Air",
    head: "in the air",
    search: "Skydive, helicopter, balloon",
    note: "",
    emptyTitle: "Nothing in the air",
    emptyBody: "No air experiences match that search.",
  },
  water: {
    railEyebrow: "",
    railTitle: "Water",
    head: "on the water",
    search: "Jet ski, kayak, charter",
    note: "",
    emptyTitle: "Nothing on the water",
    emptyBody: "No water experiences match that search.",
  },
  motorsport: {
    railEyebrow: "",
    railTitle: "Racing",
    head: "on track",
    search: "Karting, track time",
    note: "",
    emptyTitle: "Nothing on track",
    emptyBody: "No motorsport experiences match that search.",
  },
  indoor: {
    railEyebrow: "",
    railTitle: "Indoor",
    head: "indoors",
    search: "Escape room, axe throwing",
    note: "",
    emptyTitle: "Nothing indoors",
    emptyBody: "No indoor experiences match that search.",
  },
  outdoor: {
    railEyebrow: "",
    railTitle: "Outdoor",
    head: "outdoors",
    search: "Paintball, horseback",
    note: "",
    emptyTitle: "Nothing outdoors",
    emptyBody: "No outdoor experiences match that search.",
  },
} as Record<string, CategoryMeta>;
