import type { Listing } from "./types";

export const LISTINGS = [
  {
    id:"skydive-tandem", cat:"air", art:"skydive",
    title:"Tandem Skydive · 14,000 ft",
    op:"Gulf Coast Skydive", opInit:"GS", opSince:"Operating since 2004",
    launch:"Zephyrhills Municipal Airport · Hangar 3", dist:"31 mi",
    rating:4.9, reviews:2841,
    price:269, unit:"person", minHours:3, qtyLabel:"Jumpers", qtyMax:6, qtyUnit:"jumper",
    specs:["14,000 ft exit","~60 sec freefall","USPA instructor","No experience needed"],
    facts:[["Exit altitude","14,000 ft"],["Freefall","About 60 seconds"],["On site","2-3 hours"],["Weight limit","240 lb"]],
    blurb:"Harnessed to a USPA-rated tandem instructor from the door to the ground. Twenty minutes of ground school, a fifteen-minute climb to altitude, a minute of freefall, then five to seven minutes under canopy over the Green Swamp.",
    policy:[
      "Hard weight limit of 240 lb, and it is checked on a scale at manifest - book honestly or the slot is forfeited.",
      "Winds over 20 kt or a cloud ceiling under 4,500 ft grounds the loads. You get a text and a free reschedule, never a lost deposit.",
      "Bring a government photo ID. Under 18 cannot jump, even with a parent present.",
      "Arrive 45 minutes before your load time. Miss manifest and you roll to the next available load, space permitting."
    ],
    addons:[
      {id:"handcam", name:"Instructor handcam video + stills", note:"Edited clip texted before you leave", price:119},
      {id:"outside", name:"Outside videographer", note:"Second flyer films your exit and freefall", price:159},
      {id:"early", name:"First load of the day", note:"Smoothest air, shortest wait", price:35}
    ]
  },
  {
    id:"kart-indoor", cat:"motorsport", art:"kart",
    title:"30-Lap Indoor Karting",
    op:"Apex Indoor Karting", opInit:"AK", opSince:"Operating since 2018",
    launch:"4120 Adamo Dr, Tampa · Bay 2", dist:"6.8 mi",
    rating:4.7, reviews:934,
    price:89, unit:"person", minHours:2, qtyLabel:"Drivers", qtyMax:10, qtyUnit:"driver",
    specs:["45 mph electric karts","30 laps","Timed + ranked","Ages 13+"],
    facts:[["Karts","Electric, 45 mph"],["Format","Practice + 2 races"],["On site","About 90 minutes"],["Min height","4'10\""]],
    blurb:"Three heats on a half-mile indoor circuit: a practice run, a qualifier, and a final gridded off your qualifying time. Lap times land in your phone before you leave the building, which is the part everyone actually argues about afterward.",
    policy:[
      "Closed-toe shoes required, no exceptions. Helmets, head socks, and neck braces provided.",
      "Drivers 13-17 need a parent or guardian to sign the waiver in person or online beforehand.",
      "Long hair must be tied back and tucked in. No loose scarves, lanyards, or hoodie strings.",
      "Free reschedule up to 4 hours out. No-shows forfeit the booking."
    ],
    addons:[
      {id:"pit", name:"Private pit lounge, 90 min", note:"Your own space between heats", price:120},
      {id:"heat4", name:"Fourth heat", note:"Adds 10 laps per driver", price:24},
      {id:"catering", name:"Pizza + drinks for the group", note:"Set out after the final", price:95}
    ]
  },
  {
    id:"vx-cruiser", cat:"water", art:"jetski",
    title:"Yamaha VX Cruiser",
    op:"Gulf Coast Watersports", opInit:"GC", opSince:"Operating since 2016",
    launch:"Clearwater Beach Marina · Slip 14", dist:"22 mi",
    rating:4.9, reviews:312,
    price:129, unit:"hr", minHours:2, qtyLabel:"Skis", qtyMax:4, qtyUnit:"ski",
    specs:["110 HP","3 riders","No license needed","Fuel included"],
    facts:[["Engine","110 HP · 1049cc"],["Capacity","3 riders / ski"],["Minimum","2 hours"],["Ride area","Clearwater Pass"]],
    blurb:"Two-hour ride-anywhere rental inside the Clearwater Pass zone. Skis are pulled from the rack and idling at the dock ten minutes before your slot, so a two-hour booking is two hours on the water.",
    policy:[
      "Florida Boating Safety ID issued on site - required if you were born after Jan 1, 1988. Takes about 12 minutes.",
      "PFDs, safety lanyard, and dry bag included. Fuel included up to 12 gal.",
      "$500 security hold on the card at check-in, released within 48 hours.",
      "Small-craft advisory or 4 ft+ chop: free reschedule or full refund, your call."
    ],
    addons:[
      {id:"gopro", name:"GoPro Hero + head mount", note:"Footage airdropped at return", price:35},
      {id:"tube", name:"Towable tube + rope", note:"Two riders, requires 2 skis", price:45},
      {id:"delivery", name:"Trailer delivery to Dunedin", note:"Meet at Marina Way ramp", price:80}
    ]
  },
  {
    id:"escape-vault", cat:"indoor", art:"escape",
    title:"The Vault · 60-Minute Escape Room",
    op:"Lockdown Escape Rooms", opInit:"LE", opSince:"Operating since 2015",
    launch:"618 N Franklin St, Tampa · Suite 200", dist:"5.1 mi",
    rating:4.8, reviews:1476,
    price:38, unit:"person", minHours:1, qtyLabel:"Players", qtyMax:8, qtyUnit:"player",
    specs:["60 minutes","2-8 players","Private booking","34% escape rate"],
    facts:[["Duration","60 minutes"],["Difficulty","4 of 5"],["Escape rate","34%"],["Group","Private, never merged"]],
    blurb:"A 1970s bank heist built across three connected rooms, with a real vault door that swings on a timer. Every booking is private - you will never be paired with strangers - and the game master feeds hints through an in-room monitor only when you ask for them.",
    policy:[
      "Arrive 15 minutes early for the briefing; the clock starts on schedule whether or not the group is complete.",
      "Two-player minimum. Recommended 4-6 for a first attempt at this room.",
      "Players 13 and under need an adult in the room. No physical force is ever required to solve anything.",
      "Reschedule free up to 24 hours out. Inside 24 hours the booking is non-refundable."
    ],
    addons:[
      {id:"photo3", name:"Team photo + digital badge", note:"Shot at the vault door", price:0},
      {id:"hints", name:"Unlimited hints mode", note:"For younger or first-time groups", price:15}
    ]
  },
  {
    id:"heli-bay", cat:"air", art:"heli",
    title:"20-Minute Bay Helicopter Tour",
    op:"Bayfront Helicopters", opInit:"BH", opSince:"Operating since 2012",
    launch:"Peter O. Knight Airport · Ramp A", dist:"7.4 mi",
    rating:4.9, reviews:688,
    price:189, unit:"person", minHours:1, qtyLabel:"Seats", qtyMax:3, qtyUnit:"seat",
    specs:["Robinson R44","3 passengers","20 min air time","Front seat available"],
    facts:[["Aircraft","Robinson R44 Raven II"],["Air time","20 minutes"],["Seats","3 passengers"],["Route","Downtown + Davis Islands"]],
    blurb:"Up off Davis Islands, north along the Hillsborough channel past the downtown towers, then a wide turn over the Bayshore seawall on the way back. Every seat is a window seat and the headsets are on intercom, so you can hear the pilot call out what you are looking at.",
    policy:[
      "Combined passenger weight cannot exceed 500 lb; individual passengers over 250 lb must buy a second seat.",
      "Front seat is assigned by the pilot for weight and balance - it is not first come, first served.",
      "Low ceilings or thunderstorms within 10 miles scrub the flight. Full refund or free reschedule.",
      "Check in 20 minutes early with photo ID. No bags in the cabin; lockers provided."
    ],
    addons:[
      {id:"extend2", name:"Extend to 35 minutes", note:"Adds the Gandy and Ybor loop", price:110},
      {id:"gimbal", name:"Cabin camera footage", note:"Shot from the nose mount", price:60}
    ]
  },
  {
    id:"axe-lanes", cat:"indoor", art:"axe",
    title:"Private Axe Lane · 1 Hour",
    op:"Timber Axe House", opInit:"TA", opSince:"Operating since 2019",
    launch:"2210 E 7th Ave, Ybor City", dist:"6.2 mi",
    rating:4.8, reviews:512,
    price:28, unit:"person", minHours:1, qtyLabel:"Throwers", qtyMax:8, qtyUnit:"thrower",
    specs:["Private lane","Coach included","BYOB","Ages 15+"],
    facts:[["Lane","Private, 2 targets"],["Duration","60 minutes"],["Capacity","8 throwers"],["Coach","First 15 minutes"]],
    blurb:"Your own double-target lane with a coach who gets everybody sticking axes in the first fifteen minutes, then runs a bracket for the rest of the hour. Most groups spend the last twenty minutes inventing their own scoring rules, which the coaches encourage.",
    policy:[
      "Closed-toe shoes required. Anyone in sandals is turned away and the slot is forfeited.",
      "BYOB beer and wine allowed; no liquor. Throwing stops for anyone the coach judges over the line.",
      "Minimum age 15, and 15-17 need a guardian waiver signed in person.",
      "Free cancellation up to 12 hours out."
    ],
    addons:[
      {id:"second", name:"Add a second hour", note:"Same lane, same coach", price:22},
      {id:"knives", name:"Knife and throwing-star station", note:"Coach-supervised, 20 minutes", price:40}
    ]
  },
  {
    id:"balloon-sunrise", cat:"air", art:"balloon",
    title:"Sunrise Hot Air Balloon Flight",
    op:"Big Red Balloon Co.", opInit:"BR", opSince:"Operating since 1997",
    launch:"Meet at Lutz launch field · text sent 5 PM prior", dist:"18 mi",
    rating:4.9, reviews:1203,
    price:245, unit:"person", minHours:4, qtyLabel:"Passengers", qtyMax:8, qtyUnit:"passenger",
    specs:["Sunrise only","1 hr air time","Champagne toast","FAA-certified pilot"],
    facts:[["Air time","About 60 minutes"],["Total time","4 hours door to door"],["Basket","8 passengers"],["Launch","Just after sunrise"]],
    blurb:"Balloons fly at sunrise because that is the only part of the day the air is calm enough. You help unroll and inflate the envelope, fly an hour over the Pasco pastureland at whatever altitude the pilot finds the best wind, then land wherever the chase crew can reach you.",
    policy:[
      "The exact launch field is texted the evening before - it depends entirely on the morning wind direction.",
      "Meet time is roughly 45 minutes before sunrise. This is not negotiable; the flight window is short.",
      "Passengers must be able to stand for 60 minutes and climb into a chest-high basket unassisted.",
      "Weather scrubs are common and always rebooked free. Roughly one flight in five is postponed."
    ],
    addons:[
      {id:"champ2", name:"Traditional champagne toast", note:"At the landing site, with the crew", price:0},
      {id:"private", name:"Private basket for your group", note:"No other passengers aboard", price:600}
    ]
  },
  {
    id:"paintball-day", cat:"outdoor", art:"paintball",
    title:"Half-Day Paintball Field",
    op:"Ridgeline Paintball", opInit:"RP", opSince:"Operating since 2009",
    launch:"14200 Ridge Rd, Odessa · Main staging", dist:"24 mi",
    rating:4.6, reviews:407,
    price:55, unit:"person", minHours:4, qtyLabel:"Players", qtyMax:20, qtyUnit:"player",
    specs:["4 hours","500 paintballs","Gear included","6 fields"],
    facts:[["Duration","4 hours"],["Included","500 paintballs"],["Fields","6, rotating"],["Min age","10"]],
    blurb:"Six fields in rotation - speedball bunkers, a wooded creek line, and a two-story village that decides most of the day's arguments. Rental marker, mask, hopper, and pod pack are included, and refs run every game.",
    policy:[
      "Field paint only. Outside paintballs are not permitted and will be confiscated at staging.",
      "Masks stay on inside the netting, full stop. One removal is a warning, the second ends your day.",
      "Wear long sleeves, long pants, and shoes you do not care about. Welts are part of it.",
      "Extra paint is $22 per 500. Most groups shoot 1,000-1,500 across four hours."
    ],
    addons:[
      {id:"paint2", name:"Extra 1,000 paintballs", note:"Held at staging for your group", price:40},
      {id:"upgrade", name:"Upgrade to electronic markers", note:"Per player, faster rate of fire", price:25},
      {id:"lunch", name:"Lunch on the deck", note:"Burgers, dogs, drinks", price:14}
    ]
  },
  {
    id:"bennington-24", cat:"water", art:"pontoon",
    title:"24' Bennington · Captained",
    op:"Salt Life Charters", opInit:"SL", opSince:"Operating since 2011",
    launch:"Island Way Marina · Dock B", dist:"23 mi",
    rating:4.8, reviews:187,
    price:145, unit:"hr", minHours:4, qtyLabel:"Guests", qtyMax:10, qtyUnit:"guest",
    specs:["Captain included","10 guests","Bimini shade","Cooler + ice"],
    facts:[["Vessel","24 ft tri-toon"],["Capacity","10 guests"],["Minimum","4 hours"],["Route","Caladesi + sandbar"]],
    blurb:"A licensed captain runs the boat, so nobody in your group has to. Standard route is the Caladesi sandbar with a stop at Three Rooker Bar; the captain will rework it on the fly if you want more swimming or more shade.",
    policy:[
      "USCG-licensed captain, gratuity not included (20% is customary).",
      "Cooler, ice, bluetooth stereo, and freshwater rinse included. Bring your own food and drinks.",
      "Fuel surcharge of $40 for routes past Anclote Key.",
      "Free cancellation up to 24 hours before departure."
    ],
    addons:[
      {id:"cater", name:"Cuban sandwich platter", note:"From Bascom's, boards with you", price:110},
      {id:"floats", name:"Two inflatable island floats", note:"Anchored at the sandbar", price:40},
      {id:"sunset", name:"Extend to sunset", note:"Adds roughly 90 minutes", price:190}
    ]
  },
  {
    id:"horseback-beach", cat:"outdoor", art:"horse",
    title:"Beach Horseback Ride",
    op:"Sunset Trails Ranch", opInit:"ST", opSince:"Operating since 2006",
    launch:"Fort De Soto · North Beach trailhead", dist:"34 mi",
    rating:4.9, reviews:622,
    price:145, unit:"person", minHours:2, qtyLabel:"Riders", qtyMax:8, qtyUnit:"rider",
    specs:["90 min ride","Beach + swim","No experience needed","Helmets provided"],
    facts:[["Ride time","90 minutes"],["Group","8 riders max"],["Weight limit","230 lb"],["Terrain","Sand + shallow surf"]],
    blurb:"A walking-pace ride down the north beach with a swim segment at the turnaround, where the horses wade chest-deep and you stay in the saddle. Guides match every rider to a horse by size and nerve, and about half of each group has never ridden before.",
    policy:[
      "Hard weight limit of 230 lb for the welfare of the horses. Verified at check-in.",
      "Long pants and closed-toe shoes required. Helmets provided and mandatory for riders under 18.",
      "Minimum age 8 to ride alone; younger children can be led on a pony at the ranch instead.",
      "Lightning within 10 miles cancels the ride; you will be rebooked at no cost."
    ],
    addons:[
      {id:"photos3", name:"Guide photo set", note:"Shot from the water at the turnaround", price:45},
      {id:"sunsetride", name:"Move to the sunset ride", note:"Last departure of the day", price:30}
    ]
  },
  {
    id:"parasail-600", cat:"air", art:"parasail",
    title:"600 ft Parasail Flight",
    op:"Sky High Clearwater", opInit:"SH", opSince:"Operating since 2014",
    launch:"Pier 60 · Beach launch", dist:"22 mi",
    rating:4.8, reviews:1104,
    price:89, unit:"person", minHours:2, qtyLabel:"Flyers", qtyMax:12, qtyUnit:"flyer",
    specs:["10-12 min air time","Solo or tandem","Dry launch","Ages 5+"],
    facts:[["Line length","600 ft"],["Air time","10-12 min"],["Boat time","About 90 min"],["Weight limit","450 lb / flight"]],
    blurb:"Dry take-off and dry landing straight off the back deck - you can go up in dry clothes and come down the same way, or ask for a toe dip on the way in. Boat holds 12, so you watch everyone else's flight too.",
    policy:[
      "Combined weight per flight must fall between 100 and 450 lb; the crew pairs riders at check-in.",
      "Check in 30 minutes before the boat time listed on your booking.",
      "Wind over 18 kt grounds the boat - you'll get a text and a free reschedule.",
      "Observers ride along for $25 if there's a seat left."
    ],
    addons:[
      {id:"photos", name:"Flight photo package", note:"Shot from the deck, sent same day", price:40},
      {id:"observer", name:"Add an observer seat", note:"Rides along, does not fly", price:25}
    ]
  },
  {
    id:"inshore-half", cat:"water", art:"fishing",
    title:"Half-Day Inshore Charter",
    op:"Reel Deal Guides", opInit:"RD", opSince:"Operating since 2008",
    launch:"Dunedin Marina · Slip 22", dist:"27 mi",
    rating:5.0, reviews:241,
    price:475, unit:"trip", minHours:4, qtyLabel:"Anglers", qtyMax:4, qtyUnit:"angler",
    specs:["4 hours","Up to 4 anglers","Rods + bait","License covered"],
    facts:[["Target","Snook, redfish, trout"],["Capacity","4 anglers"],["Duration","4 hours"],["Waters","St. Joseph Sound"]],
    blurb:"Live-bait inshore trip on a 22' Pathfinder working the mangrove edges and grass flats of St. Joseph Sound. Capt. Ruiz cast-nets fresh bait before you board, so the clock starts on fish, not on chores.",
    policy:[
      "Rods, tackle, live bait, ice, and your fishing license are all covered.",
      "Catch is cleaned and bagged at the dock at no charge.",
      "Bring food, drinks, sun protection, and non-marking shoes.",
      "Lightning or 20+ kt wind: rescheduled at no cost."
    ],
    addons:[
      {id:"extend", name:"Extend to 6 hours", note:"Push out to the near-shore reefs", price:180},
      {id:"cook", name:"Hook-and-cook at Frenchy's", note:"They cook your catch, food billed separately", price:0}
    ]
  },
  {
    id:"cat-sunset", cat:"water", art:"cruise",
    title:"Sunset Catamaran Sail",
    op:"Windward Sail Co.", opInit:"WS", opSince:"Operating since 2013",
    launch:"Clearwater Beach Marina · Dock 3", dist:"22 mi",
    rating:4.9, reviews:520,
    price:72, unit:"person", minHours:2, qtyLabel:"Guests", qtyMax:30, qtyUnit:"guest",
    specs:["2 hr sail","Open bar","Dolphin route","Live acoustic"],
    facts:[["Vessel","42 ft catamaran"],["Duration","2 hours"],["Capacity","30 guests"],["Departs","Dock 3"]],
    blurb:"Two hours under sail timed so you're off the beach and pointed west when the sun drops. Beer, wine, and a house rum punch are included, and the dolphin pods near the pass usually run the wake on the way back in.",
    policy:[
      "Beer, wine, rum punch, and soft drinks included. No outside alcohol.",
      "Boards 20 minutes before the listed departure; the boat leaves on time.",
      "Adults-only on the 17:00 departure.",
      "Sails rain or shine; cancelled only for lightning within 10 miles."
    ],
    addons:[
      {id:"front", name:"Front trampoline seats", note:"Reserved bow netting for your group", price:30},
      {id:"champ", name:"Bottle of champagne", note:"Poured at sunset", price:55}
    ]
  }
] as Listing[];
