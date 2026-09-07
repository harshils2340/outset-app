export type NationalTarget = {
  name: string;
  website: string;
  metroId: string;
  categoryId: string;
};

/** Real public operator homepages. Facts come from scrape, not invented prices. */
export const NATIONAL_TARGETS: NationalTarget[] = [
  { name: "Maverick Helicopters", website: "https://www.maverickhelicopter.com", metroId: "las-vegas", categoryId: "heli" },
  { name: "Papillon Grand Canyon Helicopters", website: "https://www.papillon.com", metroId: "las-vegas", categoryId: "heli" },
  { name: "Blue Hawaiian Helicopters", website: "https://www.bluehawaiian.com", metroId: "honolulu", categoryId: "heli" },
  { name: "Skydive Perris", website: "https://skydiveperris.com", metroId: "los-angeles", categoryId: "skydive" },
  { name: "Skydive Chicago", website: "https://www.skydivechicago.com", metroId: "chicago", categoryId: "skydive" },
  { name: "Mile-Hi Skydiving", website: "https://www.milehiskydiving.com", metroId: "denver", categoryId: "skydive" },
  { name: "Skydive Arizona", website: "https://www.skydiveaz.com", metroId: "phoenix", categoryId: "skydive" },
  { name: "Circle Line Sightseeing", website: "https://www.circleline.com", metroId: "nyc", categoryId: "cruise" },
  { name: "Liberty Helicopters", website: "https://libertyhelicopter.com", metroId: "nyc", categoryId: "heli" },
  { name: "Argosy Cruises", website: "https://www.argosycruises.com", metroId: "seattle", categoryId: "cruise" },
  { name: "Adventure Cat Sailing", website: "https://www.adventurecat.com", metroId: "san-francisco", categoryId: "cruise" },
  { name: "Alcatraz City Cruises", website: "https://www.alcatrazcitycruises.com", metroId: "san-francisco", categoryId: "cruise" },
  { name: "San Diego Harbor Excursion", website: "https://www.sdhe.com", metroId: "san-diego", categoryId: "cruise" },
  { name: "Steamboat Natchez", website: "https://www.steamboatnatchez.com", metroId: "new-orleans", categoryId: "cruise" },
  { name: "Austin Rowing Dock", website: "https://www.rowingdock.com", metroId: "austin", categoryId: "kayak" },
  { name: "Boston Harbor Cruises", website: "https://www.bostonharborcruises.com", metroId: "boston", categoryId: "cruise" },
  { name: "Maid of the Mist", website: "https://www.maidofthemist.com", metroId: "niagara", categoryId: "cruise" },
  { name: "Harbour Air", website: "https://harbourair.com", metroId: "vancouver", categoryId: "heli" },
  { name: "Jericho Beach Kayak", website: "https://jerichobeachkayak.com", metroId: "vancouver", categoryId: "kayak" },
  { name: "Deep Cove Kayak", website: "https://deepcovekayak.com", metroId: "vancouver", categoryId: "kayak" },
  { name: "Eagle Wing Tours", website: "https://www.eaglewingtours.com", metroId: "victoria", categoryId: "cruise" },
  { name: "Saute-Moutons Jet Boating", website: "https://jetboatingmontreal.com", metroId: "montreal", categoryId: "cruise" },
  { name: "Murphy's on the Water", website: "https://www.murphysonthewater.com", metroId: "halifax", categoryId: "cruise" },
  { name: "Niagara City Cruises", website: "https://www.niagaracruises.com", metroId: "niagara", categoryId: "cruise" },
  { name: "Banff Trail Riders", website: "https://www.horseback.com", metroId: "banff", categoryId: "horse" },
  { name: "National Helicopters", website: "https://www.nationalhelicopters.com", metroId: "toronto", categoryId: "heli" },
];
