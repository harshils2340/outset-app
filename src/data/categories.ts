import type { ArtKind, Category, CategoryId, CategoryMeta, Unclaimed } from "./types";

export const CATS = [
  { id: "all", name: "All", icon: "catAll" },
  { id: "air", name: "Air", icon: "catAir" },
  { id: "water", name: "Water", icon: "catWater" },
  { id: "motorsport", name: "Race", icon: "catMotorsport" },
  { id: "indoor", name: "Indoor", icon: "catIndoor" },
  { id: "outdoor", name: "Outdoor", icon: "catOutdoor" },
  { id: "play", name: "Play", icon: "catPlay" },
  { id: "food", name: "Food & drink", icon: "catFood" },
  { id: "wellness", name: "Wellness", icon: "catWellness" },
  { id: "classes", name: "Classes", icon: "catClasses" },
  { id: "culture", name: "Culture", icon: "catCulture" },
] as Category[];

/**
 * Tabs the catalog does not know about. `cat` on a record is set by the sync (backend), so Classes and Culture
 * are cut by kind of activity here instead. A kind may sit in two tabs: yoga is Wellness and Classes.
 */
export const VIRTUAL_CATS: Partial<Record<CategoryId, ArtKind[]>> = {
  classes: ["cooking", "pottery", "dance", "yoga", "fitness", "martialarts", "gymnastics", "swim", "surf", "sailing", "scuba", "climbing", "archery", "tennis"],
  culture: ["museum", "theatre", "garden", "zoo", "aquarium", "tour"],
};

/** Whether a listing belongs under a category tab, real or virtual. */
export function inCat(u: Pick<Unclaimed, "cat" | "art">, cat: CategoryId): boolean {
  if (cat === "all") return true;
  const arts = VIRTUAL_CATS[cat];
  return arts ? arts.includes(u.art) : u.cat === cat;
}

export const CATMETA = {
  all: {
    railEyebrow: "",
    railTitle: "Near you",
    head: "experiences",
    search: "Kayak, cooking class, brewery, golf",
    note: "",
    emptyTitle: "No experiences match that",
    emptyBody: "Try another category or a different city.",
  },
  air: {
    railEyebrow: "",
    railTitle: "Air",
    head: "in the air",
    search: "Skydive, helicopter, balloon, paragliding",
    note: "",
    emptyTitle: "Nothing in the air",
    emptyBody: "No air experiences match that search.",
  },
  water: {
    railEyebrow: "",
    railTitle: "Water",
    head: "on the water",
    search: "Jet ski, kayak, fishing charter, scuba",
    note: "",
    emptyTitle: "Nothing on the water",
    emptyBody: "No water experiences match that search.",
  },
  motorsport: {
    railEyebrow: "",
    railTitle: "Racing",
    head: "on track",
    search: "Karting, ATV, motocross, track time",
    note: "",
    emptyTitle: "Nothing on track",
    emptyBody: "No motorsport experiences match that search.",
  },
  indoor: {
    railEyebrow: "",
    railTitle: "Indoor",
    head: "indoors",
    search: "Escape room, axe throwing, climbing gym, rage room",
    note: "",
    emptyTitle: "Nothing indoors",
    emptyBody: "No indoor experiences match that search.",
  },
  outdoor: {
    railEyebrow: "",
    railTitle: "Outdoor",
    head: "outdoors",
    search: "Golf, campground, horseback, tennis, ski",
    note: "",
    emptyTitle: "Nothing outdoors",
    emptyBody: "No outdoor experiences match that search.",
  },
  play: {
    railEyebrow: "",
    railTitle: "Play",
    head: "to play",
    search: "Bowling, arcade, ice rink, theme park, karaoke",
    note: "",
    emptyTitle: "Nothing to play",
    emptyBody: "No play experiences match that search.",
  },
  food: {
    railEyebrow: "",
    railTitle: "Food & drink",
    head: "to taste",
    search: "Brewery, winery, distillery, cooking class",
    note: "",
    emptyTitle: "Nothing to taste",
    emptyBody: "No food or drink experiences match that search.",
  },
  wellness: {
    railEyebrow: "",
    railTitle: "Wellness",
    head: "to unwind",
    search: "Spa, massage, sauna, yoga, martial arts",
    note: "",
    emptyTitle: "Nothing to unwind with",
    emptyBody: "No wellness experiences match that search.",
  },
  classes: {
    railEyebrow: "",
    railTitle: "Classes",
    head: "to learn",
    search: "Cooking, pottery, dance, martial arts, swim",
    note: "",
    emptyTitle: "No classes here",
    emptyBody: "No classes or lessons match that search.",
  },
  culture: {
    railEyebrow: "",
    railTitle: "Culture",
    head: "to see",
    search: "Museum, theatre, zoo, aquarium, tour",
    note: "",
    emptyTitle: "Nothing to see",
    emptyBody: "No museums, shows, gardens, zoos or tours match that search.",
  },
} as Record<string, CategoryMeta>;

/* ---------- worlds: the header switch ---------- */

const I = (body: string) =>
  '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' + body + "</svg>";

/** Line icons for the kind chips inside Food & drink and Wellness, drawn to match the category icons. */
const KIND_ICON: Partial<Record<ArtKind, string>> = {
  brewery: I('<path d="M6 7h9v12a1.5 1.5 0 0 1-1.5 1.5h-6A1.5 1.5 0 0 1 6 19z"/><path d="M15 10h2a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2h-2"/><path d="M6 7a2.5 2.5 0 0 1 2.5-3.5A3 3 0 0 1 13.5 4 2 2 0 0 1 15 7"/><path d="M9 11v6M12 11v6"/>'),
  winery: I('<path d="M8 3.5h8c.5 3.5 0 7.5-4 8-4-.5-4.5-4.5-4-8z"/><path d="M12 11.5V20"/><path d="M8.5 20.5h7"/><path d="M8.2 7h7.6"/>'),
  distillery: I('<path d="M10 3.5h4"/><path d="M10.5 3.5v4L8 10.5v8.5a1.5 1.5 0 0 0 1.5 1.5h5A1.5 1.5 0 0 0 16 19v-8.5l-2.5-3v-4"/><path d="M8 13.5h8"/>'),
  cooking: I('<path d="M4 11h16"/><path d="M5.5 11v6.5A2.5 2.5 0 0 0 8 20h8a2.5 2.5 0 0 0 2.5-2.5V11"/><path d="M2.5 11H4M20 11h1.5"/><path d="M9 7.5c0-1 1-1.5 1-2.5M13 7.5c0-1 1-1.5 1-2.5"/>'),
  spa: I('<path d="M12 20c-3.5 0-7-2.5-8-6 3 0 6 1.5 8 4 2-2.5 5-4 8-4-1 3.5-4.5 6-8 6z"/><path d="M12 18c-2-2-2.5-5-1-8 .3-.7.6-1.3 1-2 .4.7.7 1.3 1 2 1.5 3 1 6-1 8z"/>'),
  sauna: I('<path d="M4 19.5h16"/><path d="M5 19.5V13h14v6.5"/><path d="M8 10c0-1.5 1.2-2 1.2-3.5S8 4.5 8 3.5M12 10c0-1.5 1.2-2 1.2-3.5S12 4.5 12 3.5M16 10c0-1.5 1.2-2 1.2-3.5S16 4.5 16 3.5"/>'),
  yoga: I('<circle cx="12" cy="5" r="1.8"/><path d="M12 8v6"/><path d="M5 11.5 12 10l7 1.5"/><path d="M7.5 19.5 12 14l4.5 5.5"/><path d="M5 19.5h14"/>'),
  fitness: I('<path d="M6.5 8v8M17.5 8v8"/><path d="M4 10v4M20 10v4"/><path d="M6.5 12h11"/>'),
  dance: I('<circle cx="13" cy="4.5" r="1.8"/><path d="m8 9.5 4-2 3 3 3.5-1"/><path d="M12 7.5 11 13l3.5 3-1.5 4.5"/><path d="m11 13-3.5 3.5L5 16"/>'),
  martialarts: I('<path d="M7 11V7.5A2.5 2.5 0 0 1 9.5 5h4.2A3.3 3.3 0 0 1 17 8.3V13a5 5 0 0 1-5 5h-1a4 4 0 0 1-4-4z"/><path d="M7 11h6.5a1.5 1.5 0 0 0 0-3H10"/><path d="M9 18v2.5h6V17"/>'),
  pottery: I('<path d="M9 4h6"/><path d="M9.5 4c0 2-3.5 3.5-3.5 8 0 4 2.5 7.5 6 7.5s6-3.5 6-7.5c0-4.5-3.5-6-3.5-8"/><path d="M6.5 11h11"/>'),
};

export type WorldId = "experiences" | "food" | "wellness";
/** One chip in the category row. Experiences chips are category tabs; Food & drink and Wellness chips are kinds. */
export type WorldChip = { id: string; name: string; icon: string; svg?: string; cat: CategoryId; art?: ArtKind };

const kindChips = (cat: CategoryId, allIcon: string, kinds: [ArtKind, string][]): WorldChip[] => [
  { id: cat, name: "All", icon: allIcon, cat },
  ...kinds.map(([art, name]) => ({ id: art, name, icon: allIcon, svg: KIND_ICON[art], cat, art })),
];

/**
 * The header switch picks a world and the category row shows only that world's chips, so Food & drink and Wellness
 * never appear twice. Experiences keeps the category tabs (its All is the whole catalog, so a search from the home
 * still reaches every business); Food & drink and Wellness narrow by kind inside their own category.
 */
export const WORLDS: { id: WorldId; label: string; icon: string; chips: WorldChip[] }[] = [
  {
    id: "experiences",
    label: "Experiences",
    icon: "catAll",
    chips: CATS.filter((c) => c.id !== "food" && c.id !== "wellness").map((c) => ({ id: c.id, name: c.name, icon: c.icon, cat: c.id })),
  },
  {
    id: "food",
    label: "Food & drink",
    icon: "catFood",
    chips: kindChips("food", "catFood", [["brewery", "Breweries"], ["winery", "Wineries"], ["distillery", "Distilleries"], ["cooking", "Cooking classes"]]),
  },
  {
    id: "wellness",
    label: "Wellness",
    icon: "catWellness",
    chips: kindChips("wellness", "catWellness", [["spa", "Spas"], ["sauna", "Saunas"], ["yoga", "Yoga"], ["fitness", "Fitness"], ["dance", "Dance"], ["martialarts", "Martial arts"], ["pottery", "Pottery"]]),
  },
];

/** The world a category tab belongs to. */
export const worldOf = (cat: CategoryId): WorldId => (cat === "food" ? "food" : cat === "wellness" ? "wellness" : "experiences");
