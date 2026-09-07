import type { ArtKind } from "./types";

/**
 * Activity guides: what a first-timer should expect for each kind of experience.
 * These describe the activity in general, the way a friend who has done it would.
 * They are not operator facts. Prices, ages, limits and rules for a specific operator
 * come only from that operator's published information.
 */
export type Guide = {
  /** Short, warm hook under the listing title. */
  hook: string;
  /** How the day goes, in order. */
  steps: string[];
  /** Typical time from check-in to done. */
  time: string;
  /** What most people bring or wear. */
  bring: string[];
  /** Who it tends to suit. */
  goodFor: string;
  /** One line of honest reassurance for nervous first-timers. */
  nerves: string;
};

export const GUIDES: Record<ArtKind, Guide> = {
  skydive: {
    hook: "Sixty seconds of freefall, then five quiet minutes under canopy with the whole coastline laid out below you.",
    steps: [
      "Check in, sign the waiver, and watch a short briefing. Your instructor walks you through the body position and the landing.",
      "Gear up in a harness that clips to your instructor. You'll practice the arch on the ground.",
      "The plane climbs for about 15 minutes. The door opens somewhere around 10,000 to 14,000 feet.",
      "You go out attached to your instructor. Freefall lasts about a minute and feels more like floating on wind than falling.",
      "The parachute opens and everything goes quiet. Your instructor may let you steer. Landing is a gentle slide onto grass.",
    ],
    time: "Plan on 2 to 4 hours at the dropzone. Weather holds are common, so keep the day loose.",
    bring: ["Closed-toe sneakers that lace tight", "Athletic clothes, nothing loose", "Photo ID", "Contacts instead of glasses if you have them"],
    goodFor: "First-timers, birthdays, anyone who wants one big memory in a single afternoon.",
    nerves: "Almost everyone is scared in the plane and grinning on the ground. Your instructor has done this thousands of times.",
  },
  heli: {
    hook: "The city, the coast or the canyon from a few hundred feet up, with a pilot pointing out what you're looking at.",
    steps: [
      "Check in and weigh in. Seats are assigned by weight to balance the aircraft.",
      "A quick safety talk covers headsets, seatbelts, and how to approach the helicopter.",
      "Rotors spin up, and you lift straight off the pad. Most people gasp at that first moment.",
      "You fly the route with the pilot narrating through your headset. Windows are big and the ride is smooth.",
      "Land where you started. Most flights run 10 to 45 minutes depending on the tour.",
    ],
    time: "About an hour door to door for a short tour. Longer scenic flights run half a day.",
    bring: ["Photo ID", "Sunglasses", "A phone with a wrist strap for photos", "Dark clothing cuts window glare in photos"],
    goodFor: "Couples, visitors who want the overview shot, anyone who hates lines and wants a big view fast.",
    nerves: "It's calmer than most people expect, closer to a smooth car ride than a rollercoaster.",
  },
  balloon: {
    hook: "Up before dawn, then drifting with the wind while the sun comes up and the ground goes gold.",
    steps: [
      "Meet in the dark, usually an hour before sunrise. The crew checks the wind and picks a launch field.",
      "You help hold the envelope while fans and burners inflate it. It's a show in itself.",
      "Climb into the basket. Liftoff is so gentle you may not notice you've left the ground.",
      "Float for about an hour. Balloons go where the wind goes, so every flight is a different route.",
      "Land in a field, sometimes with a bump. Many operators pour a toast after touchdown.",
    ],
    time: "3 to 4 hours including the chase-vehicle ride back. Flights cancel for wind more than any other activity.",
    bring: ["Layers, it's cold at dawn", "Closed-toe shoes for wet grass", "A hat, the burner is warm overhead", "Camera with a strap"],
    goodFor: "Anniversaries, proposals, and anyone who wants calm rather than adrenaline.",
    nerves: "No sense of height and almost no motion. People with a fear of heights often do fine in a balloon.",
  },
  kart: {
    hook: "Real racing lines, lap timers, and the kind of grudge match that decides who buys dinner.",
    steps: [
      "Sign the waiver at the kiosk and pick up a head sock and helmet.",
      "Watch a two-minute briefing on flags, passing, and what happens if you spin.",
      "Race a session of 10 to 15 laps. Karts are quick, especially the electric ones.",
      "Check your lap times on the board and line up again if you want another go.",
    ],
    time: "About 20 minutes per race. Most people stay for two or three.",
    bring: ["Closed-toe shoes, no exceptions", "Long hair tied back", "Photo ID for the license"],
    goodFor: "Groups, work outings, rainy days, and anyone who thinks they'd be fast.",
    nerves: "Speed feels bigger than it is because you're inches off the ground. Bumps are padded and staff watch every corner.",
  },
  escape: {
    hook: "One locked room, one hour, and a puzzle trail that turns a group of friends into a team.",
    steps: [
      "Arrive 15 minutes early. Your game master briefs you on rules and how to ask for hints.",
      "Step into the room and the clock starts. Search everything: drawers, paintings, under the rug.",
      "Solve puzzles that unlock the next. Hints come through a screen or a walkie if you're stuck.",
      "Escape, or don't. Either way there's a group photo at the end and a debrief of what you missed.",
    ],
    time: "About 75 minutes including the briefing. Rooms usually run 60 minutes on the clock.",
    bring: ["Nothing special", "Glasses if you need them for reading", "A group of 2 to 8 is the sweet spot"],
    goodFor: "Friends, dates, families with teens, and coworkers who need a shared enemy.",
    nerves: "You're never actually locked in. Every room has an exit you can use any time.",
  },
  axe: {
    hook: "The satisfying thunk of a hatchet in a wooden target, and a bracket that gets competitive fast.",
    steps: [
      "Check in and your coach shows you the grip and the two-handed overhead throw.",
      "Practice for 10 minutes until you're sticking it. Most people land one within the first few throws.",
      "Play games like bullseye tournaments, 21, or cricket for the rest of the session.",
    ],
    time: "Lanes are usually booked for an hour. Most venues bring the group to a lane of their own.",
    bring: ["Closed-toe shoes", "Something comfortable to swing in", "Photo ID if the venue serves drinks"],
    goodFor: "Birthdays, team nights, and anyone who wants a competition that doesn't need athletic talent.",
    nerves: "A coach stays with your lane and lanes are caged. It's safer than it looks.",
  },
  paintball: {
    hook: "Cover, ambushes and capture-the-flag in the woods or an arena, with a sting that fades faster than the bragging rights.",
    steps: [
      "Check in, sign the waiver, and pick up a marker, mask and paint.",
      "A referee runs the safety talk: masks stay on in the field, barrel covers on outside it.",
      "Play a series of games on different fields. Referees reset teams between rounds.",
      "Take breaks between games. Sessions often run half a day.",
    ],
    time: "Half a day is typical. Bring water and expect to be tired and happy.",
    bring: ["Old clothes you can ruin", "Long sleeves and pants", "Boots or old sneakers", "Water and a snack"],
    goodFor: "Groups of 6 or more, bachelor parties, and teenagers with energy to burn.",
    nerves: "Hits sting like a snapped rubber band and leave small bruises. Layers help a lot.",
  },
  horse: {
    hook: "A calm horse, a slow trail and an hour where the only sound is hooves and wind in the trees.",
    steps: [
      "Meet at the barn and get matched with a horse for your size and experience.",
      "A wrangler shows you how to mount, hold the reins, and stop.",
      "Ride single file along the trail with a guide leading. Horses know the route.",
      "Return to the barn. You'll be a little sore tomorrow in a good way.",
    ],
    time: "1 to 2 hours in the saddle for a standard trail ride. Sunset rides are popular.",
    bring: ["Long pants", "Closed-toe shoes with a small heel if you have them", "Sunscreen and a hat that ties"],
    goodFor: "Families, first-timers, and anyone who wants scenery without effort.",
    nerves: "Trail horses are chosen for their patience. Guides ride with you the whole way.",
  },
  jetski: {
    hook: "Throttle, spray and open water. The fastest way to feel like you own the bay.",
    steps: [
      "Check in at the dock, sign the waiver, and show your ID or boating card if required.",
      "A quick lesson covers the throttle, the kill cord, and where the riding area ends.",
      "Ride. Freestyle rentals give you a marked zone. Guided tours follow a leader to spots like sandbars or dolphin areas.",
      "Return to the dock a few minutes before your time is up.",
    ],
    time: "Rentals run 30 minutes to a few hours. Tours are usually 1 to 2 hours.",
    bring: ["Swimsuit and a towel", "Waterproof sunscreen", "Sunglasses with a strap", "A dry bag for your phone"],
    goodFor: "Couples riding two-up, friends racing each other, and beach days that need a jolt.",
    nerves: "Life jackets are provided and required. Skis are stable at low speed and easy to climb back onto.",
  },
  pontoon: {
    hook: "Your own boat for the day. Load the cooler, find a sandbar, and let everyone take a turn at the wheel.",
    steps: [
      "Check in at the marina and complete the boating checklist with staff.",
      "A walkthrough covers the controls, the chart, the no-wake zones, and where to anchor.",
      "Cruise out. Pontoons are wide and steady, so kids and grandparents are comfortable.",
      "Anchor, swim, snack, repeat. Return before your slot ends and fuel up if required.",
    ],
    time: "Half-day and full-day rentals are standard.",
    bring: ["Cooler with water and food", "Sunscreen, hats, towels", "A speaker", "Boater card if your state requires it"],
    goodFor: "Families, mixed-age groups, and birthdays that need room to spread out.",
    nerves: "Pontoons are the easiest boats to drive. If you can park a car you can dock one with a little help.",
  },
  fishing: {
    hook: "A captain who knows where the fish are, all the gear on board, and a shot at the best photo of your year.",
    steps: [
      "Meet the captain at the dock before sunrise or midafternoon depending on the trip.",
      "Rods, bait, licenses and tackle are usually included. You just show up.",
      "Run out to the spots. Inshore trips stay in calm water, offshore trips go for bigger fish and bigger waves.",
      "Fish, with coaching if you want it. The captain cleans your catch at the end.",
    ],
    time: "Half-day trips run 4 hours. Full-day and offshore trips run 6 to 10.",
    bring: ["Sunscreen and polarized sunglasses", "Hat", "Snacks and drinks", "Motion sickness tablets for offshore trips"],
    goodFor: "Dads and daughters, bachelor groups, and anyone who wants dinner they caught themselves.",
    nerves: "You don't need experience. Captains put beginners on fish every day.",
  },
  parasail: {
    hook: "Lifted off the back of a boat into a hush a few hundred feet up, with the shoreline turning into a postcard.",
    steps: [
      "Check in on the beach or dock and sign the waiver.",
      "Ride out on the boat. Everyone flies from the boat deck, no running on sand.",
      "Get harnessed in, sit on the deck, and the line lets out. You rise slowly and quietly.",
      "Fly for about 10 minutes. Ask for a dip and they'll touch your toes in the water on the way down.",
    ],
    time: "About an hour on the boat, with groups taking turns.",
    bring: ["Swimsuit", "Sunglasses with a strap", "A GoPro if you want the shot"],
    goodFor: "Anyone who wants the view without the freefall. Kids often fly with a parent.",
    nerves: "You never leave the harness and you land back on the deck. It's far gentler than it looks from the beach.",
  },
  cruise: {
    hook: "Golden hour on the water, a drink in hand, and a skyline or coastline doing its best work.",
    steps: [
      "Board 15 to 30 minutes before departure. Grab a spot on the rail early.",
      "Cast off. Most sunset sails run 90 minutes to 2 hours.",
      "The crew narrates or plays music. Dolphins and sea birds show up more often than you'd think.",
      "Return to the dock just after dark.",
    ],
    time: "About 2 hours.",
    bring: ["A light layer, it's cooler on the water", "Camera", "Cash for the bar or a tip"],
    goodFor: "Dates, parents in town, and anyone who wants the easiest great evening available.",
    nerves: "Big, stable boats. Seasickness is rare on harbor and bay cruises.",
  },
  kayak: {
    hook: "Glassy water, mangrove tunnels or a quiet lake, and the feeling of moving under your own power.",
    steps: [
      "Check in at the launch and get fitted with a life jacket and paddle.",
      "A short lesson covers the grip, the forward stroke, and turning.",
      "Paddle out. Guided tours follow a route with wildlife stops. Rentals give you a map and a return time.",
      "Come back to the launch. Rinse off, and you're done.",
    ],
    time: "1 to 3 hours. Sunrise and sunset paddles are the calmest.",
    bring: ["Clothes that can get wet", "Water shoes or sandals with a strap", "Sunscreen and a hat", "Dry bag for your phone"],
    goodFor: "First-timers, families with kids 8 and up, and anyone who wants nature at a slow pace.",
    nerves: "Sit-on-top kayaks are wide and nearly impossible to tip. Tandem boats let a nervous paddler ride with a confident one.",
  },
};
