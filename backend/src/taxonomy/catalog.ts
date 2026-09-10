export type Family = "air" | "water" | "motorsport" | "indoor" | "outdoor" | "play" | "food" | "wellness";
export type ServiceStyle = "rental" | "tour" | "ticket" | "appointment";
export type Country = "US" | "CA";

export type CategoryDef = {
  id: string;
  family: Family;
  label: string;
  iconKey: string;
  serviceStyle: ServiceStyle;
  searchQuery: string;
};

/** Uber Eats style chips: one icon key, one label, one family. */
export const CATEGORIES: CategoryDef[] = [
  { id: "jetski", family: "water", label: "Jet ski", iconKey: "jetski", serviceStyle: "rental", searchQuery: "jet ski rental" },
  { id: "kayak", family: "water", label: "Kayak", iconKey: "kayak", serviceStyle: "rental", searchQuery: "kayak rental" },
  { id: "paddleboard", family: "water", label: "Paddleboard", iconKey: "kayak", serviceStyle: "rental", searchQuery: "paddleboard rental" },
  { id: "pontoon", family: "water", label: "Pontoon", iconKey: "pontoon", serviceStyle: "rental", searchQuery: "pontoon boat rental" },
  { id: "fishing", family: "water", label: "Fishing charter", iconKey: "fishing", serviceStyle: "tour", searchQuery: "inshore fishing charter" },
  { id: "cruise", family: "water", label: "Sunset sail", iconKey: "cruise", serviceStyle: "ticket", searchQuery: "sunset cruise" },
  { id: "skydive", family: "air", label: "Skydive", iconKey: "skydive", serviceStyle: "ticket", searchQuery: "tandem skydive" },
  { id: "heli", family: "air", label: "Helicopter", iconKey: "heli", serviceStyle: "tour", searchQuery: "helicopter tour" },
  { id: "balloon", family: "air", label: "Hot air balloon", iconKey: "balloon", serviceStyle: "tour", searchQuery: "hot air balloon ride" },
  { id: "parasail", family: "air", label: "Parasail", iconKey: "parasail", serviceStyle: "ticket", searchQuery: "parasail" },
  { id: "kart", family: "motorsport", label: "Karting", iconKey: "kart", serviceStyle: "appointment", searchQuery: "indoor go karting" },
  { id: "escape", family: "indoor", label: "Escape room", iconKey: "escape", serviceStyle: "appointment", searchQuery: "escape room" },
  { id: "axe", family: "indoor", label: "Axe throwing", iconKey: "axe", serviceStyle: "appointment", searchQuery: "axe throwing" },
  { id: "paintball", family: "outdoor", label: "Paintball", iconKey: "paintball", serviceStyle: "ticket", searchQuery: "paintball field" },
  { id: "horse", family: "outdoor", label: "Horseback", iconKey: "horse", serviceStyle: "tour", searchQuery: "horseback riding" },
  // Wave two: everything else a person books, calls about, or checks online for before going.
  { id: "bowling", family: "play", label: "Bowling", iconKey: "bowling", serviceStyle: "appointment", searchQuery: "bowling alley" },
  { id: "minigolf", family: "play", label: "Mini golf", iconKey: "minigolf", serviceStyle: "ticket", searchQuery: "mini golf" },
  { id: "arcade", family: "play", label: "Arcade", iconKey: "arcade", serviceStyle: "ticket", searchQuery: "arcade" },
  { id: "trampoline", family: "play", label: "Trampoline park", iconKey: "trampoline", serviceStyle: "ticket", searchQuery: "trampoline park" },
  { id: "lasertag", family: "play", label: "Laser tag", iconKey: "lasertag", serviceStyle: "appointment", searchQuery: "laser tag" },
  { id: "icerink", family: "play", label: "Ice skating", iconKey: "icerink", serviceStyle: "ticket", searchQuery: "ice skating rink" },
  { id: "waterpark", family: "play", label: "Water park", iconKey: "waterpark", serviceStyle: "ticket", searchQuery: "water park" },
  { id: "themepark", family: "play", label: "Theme park", iconKey: "themepark", serviceStyle: "ticket", searchQuery: "amusement park" },
  { id: "zoo", family: "play", label: "Zoo", iconKey: "zoo", serviceStyle: "ticket", searchQuery: "zoo" },
  { id: "aquarium", family: "play", label: "Aquarium", iconKey: "aquarium", serviceStyle: "ticket", searchQuery: "aquarium" },
  { id: "karaoke", family: "play", label: "Karaoke", iconKey: "karaoke", serviceStyle: "appointment", searchQuery: "karaoke rooms" },
  { id: "climbing", family: "indoor", label: "Climbing gym", iconKey: "climbing", serviceStyle: "ticket", searchQuery: "climbing gym" },
  { id: "range", family: "outdoor", label: "Shooting range", iconKey: "range", serviceStyle: "appointment", searchQuery: "shooting range" },
  { id: "archery", family: "outdoor", label: "Archery", iconKey: "archery", serviceStyle: "appointment", searchQuery: "archery range" },
  { id: "golf", family: "outdoor", label: "Golf", iconKey: "golf", serviceStyle: "appointment", searchQuery: "golf course tee times" },
  { id: "zipline", family: "outdoor", label: "Zipline", iconKey: "zipline", serviceStyle: "ticket", searchQuery: "zipline" },
  { id: "ski", family: "outdoor", label: "Ski and snowboard", iconKey: "ski", serviceStyle: "ticket", searchQuery: "ski resort lessons" },
  { id: "bike", family: "outdoor", label: "Bike rental", iconKey: "bike", serviceStyle: "rental", searchQuery: "bike rental" },
  { id: "snowmobile", family: "outdoor", label: "Snowmobile", iconKey: "snowmobile", serviceStyle: "rental", searchQuery: "snowmobile tour" },
  { id: "rafting", family: "water", label: "Rafting", iconKey: "rafting", serviceStyle: "tour", searchQuery: "whitewater rafting" },
  { id: "scuba", family: "water", label: "Scuba and snorkel", iconKey: "scuba", serviceStyle: "tour", searchQuery: "scuba diving" },
  { id: "surf", family: "water", label: "Surf lesson", iconKey: "surf", serviceStyle: "appointment", searchQuery: "surf lessons" },
  { id: "paragliding", family: "air", label: "Paragliding", iconKey: "paragliding", serviceStyle: "ticket", searchQuery: "tandem paragliding" },
  { id: "gliding", family: "air", label: "Glider flight", iconKey: "gliding", serviceStyle: "ticket", searchQuery: "glider ride" },
  { id: "brewery", family: "food", label: "Brewery", iconKey: "brewery", serviceStyle: "ticket", searchQuery: "brewery tour" },
  { id: "winery", family: "food", label: "Winery", iconKey: "winery", serviceStyle: "ticket", searchQuery: "winery tasting" },
  { id: "distillery", family: "food", label: "Distillery", iconKey: "distillery", serviceStyle: "ticket", searchQuery: "distillery tour" },
  { id: "cooking", family: "food", label: "Cooking class", iconKey: "cooking", serviceStyle: "appointment", searchQuery: "cooking class" },
  { id: "spa", family: "wellness", label: "Spa", iconKey: "spa", serviceStyle: "appointment", searchQuery: "day spa" },
  { id: "yoga", family: "wellness", label: "Yoga", iconKey: "yoga", serviceStyle: "appointment", searchQuery: "yoga studio" },
  { id: "dance", family: "wellness", label: "Dance class", iconKey: "dance", serviceStyle: "appointment", searchQuery: "dance classes" },
  { id: "pottery", family: "wellness", label: "Pottery and art class", iconKey: "pottery", serviceStyle: "appointment", searchQuery: "pottery class" },
];

export type MetroDef = {
  id: string;
  name: string;
  region: string;
  country: Country;
  kind: "coastal" | "inland" | "mountain" | "metro";
  lat: number;
  lon: number;
};

/** Coverage grid for US + Canada. Jobs are queued per metro x category. */
export const METROS: MetroDef[] = [
  { id: "tampa", name: "Tampa Bay", region: "FL", country: "US", kind: "coastal" , lat: 27.95, lon: -82.46 },
  { id: "miami", name: "Miami", region: "FL", country: "US", kind: "coastal" , lat: 25.76, lon: -80.19 },
  { id: "orlando", name: "Orlando", region: "FL", country: "US", kind: "metro" , lat: 28.54, lon: -81.38 },
  { id: "key-west", name: "Key West", region: "FL", country: "US", kind: "coastal" , lat: 24.56, lon: -81.78 },
  { id: "charleston", name: "Charleston", region: "SC", country: "US", kind: "coastal" , lat: 32.78, lon: -79.93 },
  { id: "myrtle-beach", name: "Myrtle Beach", region: "SC", country: "US", kind: "coastal" , lat: 33.69, lon: -78.89 },
  { id: "outer-banks", name: "Outer Banks", region: "NC", country: "US", kind: "coastal" , lat: 35.93, lon: -75.64 },
  { id: "virginia-beach", name: "Virginia Beach", region: "VA", country: "US", kind: "coastal" , lat: 36.85, lon: -75.98 },
  { id: "nyc", name: "New York", region: "NY", country: "US", kind: "metro" , lat: 40.71, lon: -74.01 },
  { id: "boston", name: "Boston", region: "MA", country: "US", kind: "coastal" , lat: 42.36, lon: -71.06 },
  { id: "cape-cod", name: "Cape Cod", region: "MA", country: "US", kind: "coastal" , lat: 41.68, lon: -70.28 },
  { id: "philadelphia", name: "Philadelphia", region: "PA", country: "US", kind: "metro" , lat: 39.95, lon: -75.17 },
  { id: "dc", name: "Washington DC", region: "DC", country: "US", kind: "metro" , lat: 38.91, lon: -77.04 },
  { id: "chicago", name: "Chicago", region: "IL", country: "US", kind: "metro" , lat: 41.88, lon: -87.63 },
  { id: "detroit", name: "Detroit", region: "MI", country: "US", kind: "metro" , lat: 42.33, lon: -83.05 },
  { id: "minneapolis", name: "Minneapolis", region: "MN", country: "US", kind: "metro" , lat: 44.98, lon: -93.27 },
  { id: "nashville", name: "Nashville", region: "TN", country: "US", kind: "inland" , lat: 36.16, lon: -86.78 },
  { id: "atlanta", name: "Atlanta", region: "GA", country: "US", kind: "metro" , lat: 33.75, lon: -84.39 },
  { id: "new-orleans", name: "New Orleans", region: "LA", country: "US", kind: "coastal" , lat: 29.95, lon: -90.07 },
  { id: "austin", name: "Austin", region: "TX", country: "US", kind: "inland" , lat: 30.27, lon: -97.74 },
  { id: "dallas", name: "Dallas", region: "TX", country: "US", kind: "metro" , lat: 32.78, lon: -96.8 },
  { id: "houston", name: "Houston", region: "TX", country: "US", kind: "metro" , lat: 29.76, lon: -95.37 },
  { id: "denver", name: "Denver", region: "CO", country: "US", kind: "mountain" , lat: 39.74, lon: -104.99 },
  { id: "salt-lake", name: "Salt Lake City", region: "UT", country: "US", kind: "mountain" , lat: 40.76, lon: -111.89 },
  { id: "phoenix", name: "Phoenix", region: "AZ", country: "US", kind: "inland" , lat: 33.45, lon: -112.07 },
  { id: "las-vegas", name: "Las Vegas", region: "NV", country: "US", kind: "inland" , lat: 36.17, lon: -115.14 },
  { id: "los-angeles", name: "Los Angeles", region: "CA", country: "US", kind: "coastal" , lat: 34.05, lon: -118.24 },
  { id: "san-diego", name: "San Diego", region: "CA", country: "US", kind: "coastal" , lat: 32.72, lon: -117.16 },
  { id: "san-francisco", name: "San Francisco", region: "CA", country: "US", kind: "coastal" , lat: 37.77, lon: -122.42 },
  { id: "monterey", name: "Monterey", region: "CA", country: "US", kind: "coastal" , lat: 36.6, lon: -121.89 },
  { id: "lake-tahoe", name: "Lake Tahoe", region: "CA", country: "US", kind: "mountain" , lat: 39.1, lon: -120.03 },
  { id: "portland", name: "Portland", region: "OR", country: "US", kind: "metro" , lat: 45.52, lon: -122.68 },
  { id: "seattle", name: "Seattle", region: "WA", country: "US", kind: "coastal" , lat: 47.61, lon: -122.33 },
  { id: "honolulu", name: "Honolulu", region: "HI", country: "US", kind: "coastal" , lat: 21.31, lon: -157.86 },
  { id: "anchorage", name: "Anchorage", region: "AK", country: "US", kind: "mountain" , lat: 61.22, lon: -149.9 },
  { id: "toronto", name: "Toronto", region: "ON", country: "CA", kind: "metro" , lat: 43.65, lon: -79.38 },
  { id: "niagara", name: "Niagara", region: "ON", country: "CA", kind: "metro" , lat: 43.09, lon: -79.08 },
  { id: "ottawa", name: "Ottawa", region: "ON", country: "CA", kind: "metro" , lat: 45.42, lon: -75.7 },
  { id: "montreal", name: "Montreal", region: "QC", country: "CA", kind: "metro" , lat: 45.5, lon: -73.57 },
  { id: "quebec-city", name: "Quebec City", region: "QC", country: "CA", kind: "metro" , lat: 46.81, lon: -71.21 },
  { id: "halifax", name: "Halifax", region: "NS", country: "CA", kind: "coastal" , lat: 44.65, lon: -63.58 },
  { id: "calgary", name: "Calgary", region: "AB", country: "CA", kind: "mountain" , lat: 51.05, lon: -114.07 },
  { id: "edmonton", name: "Edmonton", region: "AB", country: "CA", kind: "inland" , lat: 53.55, lon: -113.49 },
  { id: "banff", name: "Banff", region: "AB", country: "CA", kind: "mountain" , lat: 51.18, lon: -115.57 },
  { id: "vancouver", name: "Vancouver", region: "BC", country: "CA", kind: "coastal" , lat: 49.28, lon: -123.12 },
  { id: "victoria", name: "Victoria", region: "BC", country: "CA", kind: "coastal" , lat: 48.43, lon: -123.37 },
  { id: "kelowna", name: "Kelowna", region: "BC", country: "CA", kind: "inland" , lat: 49.89, lon: -119.5 },
];

export function categoryById(id: string): CategoryDef | undefined {
  return CATEGORIES.find((c) => c.id === id);
}

export function inferCategory(text: string): CategoryDef {
  const t = text.toLowerCase();
  if (/wave.?runner|waverunner|\bpwc\b|jet.?ski/.test(t)) return categoryById("jetski")!;
  if (/\bkayak|\bcanoe/.test(t)) return categoryById("kayak")!;
  if (/\bsup\b|paddle/.test(t)) return categoryById("paddleboard")!;
  if (/pontoon/.test(t)) return categoryById("pontoon")!;
  if (/fish|charter/.test(t)) return categoryById("fishing")!;
  if (/sail|cruise|catamaran/.test(t)) return categoryById("cruise")!;
  if (/skydive|tandem jump/.test(t)) return categoryById("skydive")!;
  if (/helicopter|\bheli\b/.test(t)) return categoryById("heli")!;
  if (/balloon/.test(t)) return categoryById("balloon")!;
  if (/parasail/.test(t)) return categoryById("parasail")!;
  if (/kart/.test(t)) return categoryById("kart")!;
  if (/escape/.test(t)) return categoryById("escape")!;
  if (/\baxe\b/.test(t)) return categoryById("axe")!;
  if (/paintball/.test(t)) return categoryById("paintball")!;
  if (/horse|trail ride/.test(t)) return categoryById("horse")!;
  const byId = [...CATEGORIES].sort((a, b) => b.id.length - a.id.length).find((c) => t.includes(c.id));
  if (byId) return byId;
  return categoryById("jetski")!;
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const r = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(a));
}

/** Closest metro to a point, or null if none is within maxKm. */
export function nearestMetro(lat: number, lon: number, maxKm: number): MetroDef | null {
  let best: MetroDef | null = null;
  let bestKm = Infinity;
  for (const m of METROS) {
    const km = haversineKm(lat, lon, m.lat, m.lon);
    if (km < bestKm) {
      bestKm = km;
      best = m;
    }
  }
  return best && bestKm <= maxKm ? best : null;
}
