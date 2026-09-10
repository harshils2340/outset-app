export function sceneInner(kind: string, id: string): string {
  const u = "g" + id.replace(/[^a-z0-9]/gi, "");
  const scenes: Record<string, string> = {
    skydive:`<defs><linearGradient id="${u}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#2E7FC4"/><stop offset=".58" stop-color="#8FCBE8"/><stop offset=".62" stop-color="#7FA86B"/><stop offset="1" stop-color="#456B3E"/></linearGradient></defs>
      <rect width="300" height="200" fill="url(#${u})"/>
      <ellipse cx="58" cy="46" rx="30" ry="12" fill="#F2F7FA" opacity=".7"/>
      <ellipse cx="246" cy="72" rx="24" ry="10" fill="#F2F7FA" opacity=".55"/>
      <path d="M236 26h22l-6 6h-22z" fill="#E9EDE7"/><path d="M244 28l10-8" stroke="#E9EDE7" stroke-width="2"/>
      <path d="M104 70q46-26 92 0l-16 8q-30-14-60 0z" fill="#E54D2C"/>
      <path d="M130 66q20-9 40 0l-8 5q-12-5-24 0z" fill="#F2F4F0" opacity=".8"/>
      <path d="M110 76l38 30M190 76l-38 30" stroke="#F2F4F0" stroke-width="1.5"/>
      <circle cx="150" cy="112" r="9" fill="#0B2422"/>
      <path d="M150 121v12M150 126l-11 12M150 126l11 12M141 116l-14-6M159 116l14-6" stroke="#0B2422" stroke-width="3.6" stroke-linecap="round"/>
      <path d="M0 150h300v50H0z" fill="#3E6338" opacity=".35"/>`,
    heli:`<defs><linearGradient id="${u}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#F5B268"/><stop offset=".4" stop-color="#E08A6E"/><stop offset=".66" stop-color="#3C6E8F"/><stop offset="1" stop-color="#1B3D57"/></linearGradient></defs>
      <rect width="300" height="200" fill="url(#${u})"/>
      <circle cx="242" cy="44" r="20" fill="#FFE3B0" opacity=".9"/>
      <path d="M14 132h12v-34h10v34h14V86h12v46h16V104h11v28h18V78h12v54h20v-24h11v24h22V96h12v36h20v-20h11v20h22v68H14z" fill="#173449" opacity=".7"/>
      <path d="M96 108h74l16 12h-92z" fill="#F2F4F0"/>
      <path d="M170 110l52 6-6 8-46-4z" fill="#EDEFEA"/>
      <path d="M214 104h14v10h-14z" fill="#E54D2C"/>
      <circle cx="126" cy="112" r="7" fill="#2A4E63"/>
      <path d="M60 92h150M132 92v-8" stroke="#F2F4F0" stroke-width="3.4" stroke-linecap="round"/>
      <path d="M100 122v10h70v-10M96 132h84" stroke="#E9EDE7" stroke-width="3" stroke-linecap="round" fill="none"/>`,
    balloon:`<defs><linearGradient id="${u}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#4E6FA8"/><stop offset=".42" stop-color="#EFA277"/><stop offset=".7" stop-color="#F7D3A0"/><stop offset="1" stop-color="#9BB07A"/></linearGradient></defs>
      <rect width="300" height="200" fill="url(#${u})"/>
      <circle cx="56" cy="146" r="26" fill="#FFE9BC" opacity=".85"/>
      <path d="M150 34a44 44 0 0 1 44 44c0 24-24 44-44 66-20-22-44-42-44-66a44 44 0 0 1 44-44z" fill="#E54D2C"/>
      <path d="M150 34c10 0 16 20 16 44s-6 46-16 66c-10-20-16-42-16-66s6-44 16-44z" fill="#F5F7F3"/>
      <path d="M150 34a44 44 0 0 1 24 8c-4 26-4 62-24 102z" fill="#0B2422" opacity=".08"/>
      <path d="M138 146l6 12M162 146l-6 12" stroke="#3A2A22" stroke-width="1.6"/>
      <rect x="140" y="156" width="20" height="15" rx="3" fill="#8A5C34"/>
      <path d="M0 182h300v18H0z" fill="#5E7A4A" opacity=".5"/>`,
    kart:`<defs><linearGradient id="${u}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#243038"/><stop offset=".46" stop-color="#3A4A53"/><stop offset=".47" stop-color="#5C666C"/><stop offset="1" stop-color="#3B4348"/></linearGradient></defs>
      <rect width="300" height="200" fill="url(#${u})"/>
      <path d="M0 92h300v10H0z" fill="#E54D2C"/>
      <path d="M0 92h30v10H0zM60 92h30v10H60zM120 92h30v10h-30zM180 92h30v10h-30zM240 92h30v10h-30z" fill="#F2F4F0"/>
      <path d="M56 176q94-22 190 0" stroke="#EEF1EC" stroke-width="3" stroke-dasharray="14 12" fill="none" opacity=".5"/>
      <path d="M92 148h116l-10-24h-24l-8-14h-38l-8 14h-18z" fill="#E54D2C"/>
      <path d="M126 124h48l6 10h-60z" fill="#0B2422" opacity=".35"/>
      <circle cx="150" cy="116" r="10" fill="#0B2422"/>
      <path d="M136 132h28" stroke="#F2F4F0" stroke-width="3.4" stroke-linecap="round"/>
      <ellipse cx="98" cy="152" rx="16" ry="12" fill="#141B1F"/><ellipse cx="202" cy="152" rx="16" ry="12" fill="#141B1F"/>`,
    escape:`<defs><linearGradient id="${u}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#2A2320"/><stop offset=".5" stop-color="#4A3B31"/><stop offset="1" stop-color="#1C1714"/></linearGradient></defs>
      <rect width="300" height="200" fill="url(#${u})"/>
      <path d="M150 0v22" stroke="#C9B79A" stroke-width="1.6"/>
      <circle cx="150" cy="30" r="9" fill="#FFD98F"/>
      <ellipse cx="150" cy="66" rx="86" ry="46" fill="#FFD98F" opacity=".13"/>
      <rect x="96" y="62" width="108" height="120" rx="6" fill="#6E5A48"/>
      <rect x="106" y="72" width="88" height="110" rx="4" fill="#57463A"/>
      <circle cx="150" cy="118" r="30" fill="#3B2F27" stroke="#C9B79A" stroke-width="3"/>
      <circle cx="150" cy="118" r="15" fill="#E54D2C"/>
      <path d="M150 88v10M150 138v10M120 118h10M170 118h10M129 97l7 7M171 132l7 7M171 104l7-7M129 139l7-7" stroke="#C9B79A" stroke-width="3" stroke-linecap="round"/>
      <rect x="188" y="112" width="10" height="14" rx="3" fill="#C9B79A"/>`,
    axe:`<defs><linearGradient id="${u}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#B08252"/><stop offset="1" stop-color="#7C5734"/></linearGradient></defs>
      <rect width="300" height="200" fill="url(#${u})"/>
      <path d="M0 0h300v6H0zM0 46h300v6H0zM0 96h300v6H0zM0 146h300v6H0zM0 194h300v6H0z" fill="#5F4227" opacity=".45"/>
      <circle cx="140" cy="100" r="62" fill="#EFE4D2"/>
      <circle cx="140" cy="100" r="46" fill="#EFE4D2" stroke="#2F5F86" stroke-width="4"/>
      <circle cx="140" cy="100" r="30" fill="#EFE4D2" stroke="#2F5F86" stroke-width="4"/>
      <circle cx="140" cy="100" r="14" fill="#E54D2C"/>
      <circle cx="140" cy="100" r="62" fill="none" stroke="#2F5F86" stroke-width="4"/>
      <path d="M144 96l58-30 8 14-56 30z" fill="#6B4A2C"/>
      <path d="M132 88l22-10 10 20-22 10z" fill="#C3CBCE"/>
      <path d="M154 78l6 12 14-14z" fill="#8D989C"/>`,
    paintball:`<defs><linearGradient id="${u}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#5C7C4A"/><stop offset=".5" stop-color="#3E5F33"/><stop offset=".52" stop-color="#6E7A52"/><stop offset="1" stop-color="#4A5238"/></linearGradient></defs>
      <rect width="300" height="200" fill="url(#${u})"/>
      <path d="M20 104V54q0-16 14-16M64 104V64q0-14 12-14M240 104V58q0-16-14-16M280 104V68q0-14-12-14" stroke="#2C4526" stroke-width="8" stroke-linecap="round" fill="none"/>
      <path d="M96 152q0-40 54-40t54 40z" fill="#E9EDE7"/>
      <path d="M112 152q0-30 38-30t38 30z" fill="#C8D2C6"/>
      <circle cx="132" cy="128" r="9" fill="#E54D2C"/>
      <circle cx="176" cy="140" r="6" fill="#E54D2C" opacity=".8"/>
      <circle cx="58" cy="126" r="11" fill="#E54D2C" opacity=".9"/>
      <circle cx="252" cy="150" r="8" fill="#E54D2C" opacity=".75"/>
      <path d="M0 176h300v24H0z" fill="#33431F" opacity=".45"/>`,
    horse:`<defs><linearGradient id="${u}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#F6BE84"/><stop offset=".36" stop-color="#E58B72"/><stop offset=".56" stop-color="#4E86A0"/><stop offset=".62" stop-color="#E8D6B4"/><stop offset="1" stop-color="#C8AE86"/></linearGradient></defs>
      <rect width="300" height="200" fill="url(#${u})"/>
      <circle cx="230" cy="60" r="22" fill="#FFE7B8" opacity=".92"/>
      <path d="M0 122h300v6H0z" fill="#3C6E85" opacity=".4"/>
      <path d="M86 168v-30l10-22 40-8 22 6 14-22 8 4-10 26 22 10 6 36h-12l-6-28-30-6-8 34h-12l4-32-30 4-6 28z" fill="#4A3123"/>
      <path d="M178 90l10-18 8 4-8 18z" fill="#4A3123"/>
      <circle cx="150" cy="88" r="10" fill="#0B2422"/>
      <path d="M150 98v14M150 104l-10 8M150 104l10 8" stroke="#0B2422" stroke-width="3.6" stroke-linecap="round"/>
      <path d="M20 178q34-8 66 0t66 0 66 0 62 0" stroke="#F4E4C6" stroke-width="3" opacity=".55" fill="none"/>`,
    jetski:`<defs><linearGradient id="${u}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#7EC8D8"/><stop offset=".52" stop-color="#3E97B4"/><stop offset=".53" stop-color="#136A86"/><stop offset="1" stop-color="#0B4A63"/></linearGradient></defs>
      <rect width="300" height="200" fill="url(#${u})"/>
      <circle cx="238" cy="52" r="21" fill="#FFD9A8" opacity=".92"/>
      <path d="M0 104h300v6H0z" fill="#0B4A63" opacity=".35"/>
      <path d="M96 118c14-3 20-14 34-14h44l20 12 14 2v10l-16 8H108z" fill="#F2F4F0"/>
      <path d="M130 104h34l14 12h-56z" fill="#E54D2C"/>
      <path d="M148 82l6 22h-12z" fill="#0B2422"/>
      <ellipse cx="150" cy="88" rx="9" ry="12" fill="#0B2422"/>
      <path d="M60 140c26 0 26-9 52-9M40 156c30 0 30-9 60-9M200 142c22 0 22-9 44-9" stroke="#EAF6F8" stroke-width="3.5" stroke-linecap="round" opacity=".7" fill="none"/>`,
    pontoon:`<defs><linearGradient id="${u}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#BFE3E6"/><stop offset=".55" stop-color="#6BB6C4"/><stop offset=".56" stop-color="#1C7C92"/><stop offset="1" stop-color="#0D546C"/></linearGradient></defs>
      <rect width="300" height="200" fill="url(#${u})"/>
      <path d="M0 92h300v10H0z" fill="#2A8298" opacity=".4"/>
      <rect x="72" y="120" width="160" height="12" rx="4" fill="#E9EDE7"/>
      <rect x="80" y="132" width="30" height="9" rx="4" fill="#9AA8A4"/>
      <rect x="192" y="132" width="30" height="9" rx="4" fill="#9AA8A4"/>
      <rect x="88" y="102" width="128" height="18" fill="#F5F7F3"/>
      <rect x="100" y="66" width="104" height="7" rx="3" fill="#E54D2C"/>
      <path d="M104 73v29M200 73v29" stroke="#C9D2CD" stroke-width="4"/>
      <circle cx="130" cy="94" r="7" fill="#0B2422"/><circle cx="168" cy="94" r="7" fill="#0B2422"/>
      <path d="M30 152c26 0 26-8 52-8M216 150c22 0 22-8 44-8" stroke="#E7F5F7" stroke-width="3.5" stroke-linecap="round" opacity=".65" fill="none"/>`,
    fishing:`<defs><linearGradient id="${u}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#FFB877"/><stop offset=".42" stop-color="#E5735A"/><stop offset=".43" stop-color="#2A6F86"/><stop offset="1" stop-color="#123E56"/></linearGradient></defs>
      <rect width="300" height="200" fill="url(#${u})"/>
      <circle cx="62" cy="48" r="24" fill="#FFE3B0" opacity=".9"/>
      <path d="M0 128q40-14 72 0t72 0 72 0 84 0v72H0z" fill="#0F3550" opacity=".55"/>
      <path d="M112 96c14-16 40-16 54 0-14 16-40 16-54 0z" fill="#E54D2C"/>
      <path d="M166 96l18-11v22z" fill="#E54D2C"/>
      <circle cx="126" cy="94" r="3" fill="#0B2422"/>
      <path d="M232 40l-58 54" stroke="#F2F4F0" stroke-width="4" stroke-linecap="round"/>
      <path d="M232 40q-14 26-58 46" stroke="#F2F4F0" stroke-width="1.6" opacity=".8" fill="none"/>
      <path d="M18 168q30-10 58 0t58 0 58 0 58 0" stroke="#8FC6D6" stroke-width="3" opacity=".5" fill="none"/>`,
    parasail:`<defs><linearGradient id="${u}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#5FB6E0"/><stop offset=".62" stop-color="#A8DCEF"/><stop offset=".63" stop-color="#1B7796"/><stop offset="1" stop-color="#0C4E6B"/></linearGradient></defs>
      <rect width="300" height="200" fill="url(#${u})"/>
      <path d="M78 68a72 44 0 0 1 144 0c-24-10-48-14-72-14s-48 4-72 14z" fill="#E54D2C"/>
      <path d="M126 62a24 40 0 0 1 48 0c-8-4-16-6-24-6s-16 2-24 6z" fill="#F2F4F0" opacity=".85"/>
      <path d="M86 70l60 40M214 70l-60 40" stroke="#F2F4F0" stroke-width="1.6"/>
      <circle cx="150" cy="118" r="8" fill="#0B2422"/>
      <path d="M150 126v14M150 132l-8 10M150 132l8 10" stroke="#0B2422" stroke-width="3.5" stroke-linecap="round"/>
      <path d="M150 130L246 156" stroke="#F2F4F0" stroke-width="1.4"/>
      <path d="M232 152h40v10h-46z" fill="#E9EDE7"/>
      <path d="M20 180q28-8 56 0t56 0 56 0 56 0" stroke="#DFF2F8" stroke-width="3" opacity=".55" fill="none"/>`,
    cruise:`<defs><linearGradient id="${u}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#FFC98A"/><stop offset=".3" stop-color="#F08A5D"/><stop offset=".56" stop-color="#B2557A"/><stop offset=".57" stop-color="#2B4E76"/><stop offset="1" stop-color="#16304F"/></linearGradient></defs>
      <rect width="300" height="200" fill="url(#${u})"/>
      <circle cx="150" cy="106" r="30" fill="#FFE7B8" opacity=".95"/>
      <path d="M0 114h300v6H0z" fill="#16304F" opacity=".35"/>
      <path d="M148 30v88M148 34l-40 78h40z" fill="#F5F7F3"/>
      <path d="M152 46l44 66h-44z" fill="#EDEFEA"/>
      <path d="M84 118h132l-16 20H100z" fill="#E54D2C"/>
      <path d="M30 152q30-8 58 0t58 0 58 0 58 0" stroke="#FFD9B0" stroke-width="3" opacity=".45" fill="none"/>
      <path d="M20 174q32-8 62 0t62 0 62 0 62 0" stroke="#FFD9B0" stroke-width="3" opacity=".3" fill="none"/>`
  };
  const near: Record<string, string> = { bowling: "kart", minigolf: "horse", arcade: "escape", trampoline: "skydive", lasertag: "paintball", icerink: "kayak", waterpark: "parasail", themepark: "kart", zoo: "horse", aquarium: "kayak", karaoke: "escape", climbing: "skydive", range: "paintball", archery: "paintball", golf: "horse", zipline: "parasail", ski: "skydive", bike: "horse", snowmobile: "jetski", rafting: "kayak", scuba: "kayak", surf: "jetski", paragliding: "parasail", gliding: "heli", brewery: "cruise", winery: "balloon", distillery: "cruise", cooking: "escape", spa: "balloon", yoga: "balloon", dance: "escape", pottery: "escape" };
  return scenes[kind] || scenes[near[kind] || ""] || scenes.jetski;
}

export const ART_LABEL: Record<string, string> = {
  skydive: "Skydive",
  heli: "Helicopter",
  balloon: "Balloon",
  kart: "Karting",
  escape: "Escape room",
  axe: "Axe throwing",
  paintball: "Paintball",
  horse: "Trail ride",
  jetski: "Jet ski",
  pontoon: "Pontoon",
  fishing: "Charter",
  parasail: "Parasail",
  cruise: "Cruise",
  kayak: "Kayak",
  bowling: "Bowling",
  minigolf: "Mini golf",
  arcade: "Arcades",
  trampoline: "Trampoline parks",
  lasertag: "Laser tag",
  icerink: "Ice skating",
  waterpark: "Water parks",
  themepark: "Theme parks",
  zoo: "Zoos and wildlife parks",
  aquarium: "Aquariums",
  karaoke: "Karaoke rooms",
  climbing: "Climbing gyms",
  range: "Shooting ranges",
  archery: "Archery",
  golf: "Golf tee times",
  zipline: "Ziplines",
  ski: "Ski and snowboard",
  bike: "Bike and e-bike rentals",
  snowmobile: "Snowmobile tours",
  rafting: "Whitewater rafting",
  scuba: "Scuba and snorkel",
  surf: "Surf lessons",
  paragliding: "Paragliding",
  gliding: "Glider flights",
  brewery: "Breweries",
  winery: "Wineries",
  distillery: "Distilleries",
  cooking: "Cooking classes",
  spa: "Spas and massage",
  yoga: "Yoga",
  dance: "Dance classes",
  pottery: "Pottery and art classes",
};

