import type { Category, CategoryMeta } from "./types";

export const CATS = [
  {id:"all", name:"All"},
  {id:"air", name:"Air"},
  {id:"water", name:"Water"},
  {id:"motorsport", name:"Motorsport"},
  {id:"indoor", name:"Indoor"},
  {id:"outdoor", name:"Outdoor"}
] as Category[];

export const CATMETA = {
  all:{
    railEyebrow:"Open in the next few hours", railTitle:"Go today",
    head:"bookable near you", search:"Skydive, karting, escape room…",
    note:'Every listing here is instant-book. No calls, no "we\'ll get back to you."',
    emptyTitle:"Nothing matches that", emptyBody:"Try a different category or clear the search."
  },
  air:{
    railEyebrow:"Winds permitting", railTitle:"Flying today",
    head:"going up today", search:"Skydive, helicopter, balloon…",
    note:"Air operators scrub for weather. Every one of these reschedules free, and the agent knows today's conditions.",
    emptyTitle:"Nothing in the air", emptyBody:"No air experiences match that search."
  },
  water:{
    railEyebrow:"Docks and slips open now", railTitle:"On the water today",
    head:"on the water", search:"Jet ski, pontoon, charter…",
    note:"Chop, tides and captain availability are live here. No calling the marina to find out.",
    emptyTitle:"Nothing on the water", emptyBody:"No water experiences match that search."
  },
  motorsport:{
    railEyebrow:"Grids filling now", railTitle:"Racing today",
    head:"on track", search:"Karting, track time…",
    note:"Arrive-and-drive. Lap times land in your phone before you leave the building.",
    emptyTitle:"Nothing on track", emptyBody:"No motorsport experiences match that search."
  },
  indoor:{
    railEyebrow:"Rain-proof, booking now", railTitle:"Open today",
    head:"under a roof", search:"Escape room, axe lane…",
    note:"Private bookings only - you are never merged with strangers, whatever the group size.",
    emptyTitle:"Nothing indoors", emptyBody:"No indoor experiences match that search."
  },
  outdoor:{
    railEyebrow:"Fields and trails open now", railTitle:"Out today",
    head:"in the open", search:"Paintball, horseback…",
    note:"Gear is included on every one of these. Show up in clothes you don't mind ruining.",
    emptyTitle:"Nothing outdoors", emptyBody:"No outdoor experiences match that search."
  }
} as Record<string, CategoryMeta>;
