/** Guest metro list. Keep in sync with backend/src/taxonomy/catalog.ts. */

export type Country = "US" | "CA";

export type Metro = {
  id: string;
  name: string;
  region: string;
  country: Country;
};

export const ALL_METRO_ID = "all";

/** Public city-center coordinates for distance and directions. Not operator pins. */
export const METRO_COORDS: Record<string, { lat: number; lng: number }> = {
  tampa: { lat: 27.9506, lng: -82.4572 },
  miami: { lat: 25.7617, lng: -80.1918 },
  orlando: { lat: 28.5383, lng: -81.3792 },
  "key-west": { lat: 24.5551, lng: -81.78 },
  charleston: { lat: 32.7765, lng: -79.9311 },
  "myrtle-beach": { lat: 33.6891, lng: -78.8867 },
  "outer-banks": { lat: 35.5582, lng: -75.4665 },
  "virginia-beach": { lat: 36.8529, lng: -75.978 },
  nyc: { lat: 40.7128, lng: -74.006 },
  boston: { lat: 42.3601, lng: -71.0589 },
  "cape-cod": { lat: 41.6688, lng: -70.2962 },
  philadelphia: { lat: 39.9526, lng: -75.1652 },
  dc: { lat: 38.9072, lng: -77.0369 },
  chicago: { lat: 41.8781, lng: -87.6298 },
  detroit: { lat: 42.3314, lng: -83.0458 },
  minneapolis: { lat: 44.9778, lng: -93.265 },
  nashville: { lat: 36.1627, lng: -86.7816 },
  atlanta: { lat: 33.749, lng: -84.388 },
  "new-orleans": { lat: 29.9511, lng: -90.0715 },
  austin: { lat: 30.2672, lng: -97.7431 },
  dallas: { lat: 32.7767, lng: -96.797 },
  houston: { lat: 29.7604, lng: -95.3698 },
  denver: { lat: 39.7392, lng: -104.9903 },
  "salt-lake": { lat: 40.7608, lng: -111.891 },
  phoenix: { lat: 33.4484, lng: -112.074 },
  "las-vegas": { lat: 36.1699, lng: -115.1398 },
  "los-angeles": { lat: 34.0522, lng: -118.2437 },
  "san-diego": { lat: 32.7157, lng: -117.1611 },
  "san-francisco": { lat: 37.7749, lng: -122.4194 },
  monterey: { lat: 36.6002, lng: -121.8947 },
  "lake-tahoe": { lat: 39.0968, lng: -120.0324 },
  portland: { lat: 45.5152, lng: -122.6784 },
  seattle: { lat: 47.6062, lng: -122.3321 },
  honolulu: { lat: 21.3069, lng: -157.8583 },
  anchorage: { lat: 61.2181, lng: -149.9003 },
  toronto: { lat: 43.6532, lng: -79.3832 },
  niagara: { lat: 43.0896, lng: -79.0849 },
  ottawa: { lat: 45.4215, lng: -75.6972 },
  montreal: { lat: 45.5017, lng: -73.5673 },
  "quebec-city": { lat: 46.8139, lng: -71.208 },
  halifax: { lat: 44.6488, lng: -63.5752 },
  calgary: { lat: 51.0447, lng: -114.0719 },
  edmonton: { lat: 53.5461, lng: -113.4938 },
  banff: { lat: 51.1784, lng: -115.5708 },
  vancouver: { lat: 49.2827, lng: -123.1207 },
  victoria: { lat: 48.4284, lng: -123.3656 },
  kelowna: { lat: 49.888, lng: -119.496 },
};

export const METROS: Metro[] = [
  { id: "tampa", name: "Tampa Bay", region: "FL", country: "US" },
  { id: "miami", name: "Miami", region: "FL", country: "US" },
  { id: "orlando", name: "Orlando", region: "FL", country: "US" },
  { id: "key-west", name: "Key West", region: "FL", country: "US" },
  { id: "charleston", name: "Charleston", region: "SC", country: "US" },
  { id: "myrtle-beach", name: "Myrtle Beach", region: "SC", country: "US" },
  { id: "outer-banks", name: "Outer Banks", region: "NC", country: "US" },
  { id: "virginia-beach", name: "Virginia Beach", region: "VA", country: "US" },
  { id: "nyc", name: "New York", region: "NY", country: "US" },
  { id: "boston", name: "Boston", region: "MA", country: "US" },
  { id: "cape-cod", name: "Cape Cod", region: "MA", country: "US" },
  { id: "philadelphia", name: "Philadelphia", region: "PA", country: "US" },
  { id: "dc", name: "Washington DC", region: "DC", country: "US" },
  { id: "chicago", name: "Chicago", region: "IL", country: "US" },
  { id: "detroit", name: "Detroit", region: "MI", country: "US" },
  { id: "minneapolis", name: "Minneapolis", region: "MN", country: "US" },
  { id: "nashville", name: "Nashville", region: "TN", country: "US" },
  { id: "atlanta", name: "Atlanta", region: "GA", country: "US" },
  { id: "new-orleans", name: "New Orleans", region: "LA", country: "US" },
  { id: "austin", name: "Austin", region: "TX", country: "US" },
  { id: "dallas", name: "Dallas", region: "TX", country: "US" },
  { id: "houston", name: "Houston", region: "TX", country: "US" },
  { id: "denver", name: "Denver", region: "CO", country: "US" },
  { id: "salt-lake", name: "Salt Lake City", region: "UT", country: "US" },
  { id: "phoenix", name: "Phoenix", region: "AZ", country: "US" },
  { id: "las-vegas", name: "Las Vegas", region: "NV", country: "US" },
  { id: "los-angeles", name: "Los Angeles", region: "CA", country: "US" },
  { id: "san-diego", name: "San Diego", region: "CA", country: "US" },
  { id: "san-francisco", name: "San Francisco", region: "CA", country: "US" },
  { id: "monterey", name: "Monterey", region: "CA", country: "US" },
  { id: "lake-tahoe", name: "Lake Tahoe", region: "CA", country: "US" },
  { id: "portland", name: "Portland", region: "OR", country: "US" },
  { id: "seattle", name: "Seattle", region: "WA", country: "US" },
  { id: "honolulu", name: "Honolulu", region: "HI", country: "US" },
  { id: "anchorage", name: "Anchorage", region: "AK", country: "US" },
  { id: "toronto", name: "Toronto", region: "ON", country: "CA" },
  { id: "niagara", name: "Niagara", region: "ON", country: "CA" },
  { id: "ottawa", name: "Ottawa", region: "ON", country: "CA" },
  { id: "montreal", name: "Montreal", region: "QC", country: "CA" },
  { id: "quebec-city", name: "Quebec City", region: "QC", country: "CA" },
  { id: "halifax", name: "Halifax", region: "NS", country: "CA" },
  { id: "calgary", name: "Calgary", region: "AB", country: "CA" },
  { id: "edmonton", name: "Edmonton", region: "AB", country: "CA" },
  { id: "banff", name: "Banff", region: "AB", country: "CA" },
  { id: "vancouver", name: "Vancouver", region: "BC", country: "CA" },
  { id: "victoria", name: "Victoria", region: "BC", country: "CA" },
  { id: "kelowna", name: "Kelowna", region: "BC", country: "CA" },
];

export function metroById(id: string): Metro | undefined {
  return METROS.find((m) => m.id === id);
}

export function metroCoords(id: string): { lat: number; lng: number } | null {
  return METRO_COORDS[id] ?? null;
}

export function metroLabel(id: string): string {
  if (id === ALL_METRO_ID) return "Anywhere";
  const m = metroById(id);
  return m ? m.name + ", " + m.region : id;
}

export function metroShort(id: string): string {
  if (id === ALL_METRO_ID) return "Anywhere";
  return metroById(id)?.name || id;
}
