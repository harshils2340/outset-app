/** State, province and territory names by the two-letter code a listing's area ends in ("Tampa, FL"). */
export const REGION_NAME: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut", DE: "Delaware", DC: "Washington, DC",
  FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana",
  ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska",
  NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio",
  OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas",
  UT: "Utah", VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming", PR: "Puerto Rico",
  AB: "Alberta", BC: "British Columbia", MB: "Manitoba", NB: "New Brunswick", NL: "Newfoundland and Labrador", NS: "Nova Scotia", NT: "Northwest Territories",
  NU: "Nunavut", ON: "Ontario", PE: "Prince Edward Island", QC: "Quebec", SK: "Saskatchewan", YT: "Yukon",
};

export const CA_REGIONS = new Set(["AB", "BC", "MB", "NB", "NL", "NS", "NT", "NU", "ON", "PE", "QC", "SK", "YT"]);

/** The country a two-letter state or province code sits in. Anything we do not know is American, which 51,940 of the catalog's 59,163 rows are. */
export function countryOfRegion(code: string | undefined): "US" | "CA" {
  return CA_REGIONS.has(String(code || "").toUpperCase()) ? "CA" : "US";
}

/** The country a listing's area line names ("Kelowna, BC" is Canada, "Tampa, FL" is not). */
export function countryOfArea(area: string | undefined): "US" | "CA" {
  return countryOfRegion(regionOfArea(area));
}

/**
 * The state or province a listing's area names, or "" when it names none.
 *
 * Usually the code after the town ("Tampa, FL"), but an operator whose town the crawl never found publishes
 * the code on its own ("SK"), which is the honest gap the rules ask for and not a missing region: 4,736 of the
 * catalog's rows. Asking for a comma in front of it hid all of them from every state and province row, so a
 * guest who picked Saskatchewan was shown 63 businesses out of 224, and the Northwest Territories one out of
 * twelve. The town itself is never read, so the catalog's "Mt, NJ" stays in New Jersey, and every candidate is
 * checked against the table, so a two letter word inside a place name cannot stand in for a code.
 */
export function regionOfArea(area: string | undefined): string {
  const parts = (area || "").split(",");
  for (const part of parts.slice(parts.length > 1 ? 1 : 0)) {
    const code = part.trim().toUpperCase();
    if (code.length === 2 && REGION_NAME[code]) return code;
  }
  return "";
}
