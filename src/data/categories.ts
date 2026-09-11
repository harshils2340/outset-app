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
