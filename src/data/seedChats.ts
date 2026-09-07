import type { ChatMessage } from "./types";

export const SEED_CHATS = {
    "skydive-tandem":[
      {who:"them",t:"Gulf Coast Skydive - you're talking to our booking agent. Ask about load times, weight limits, or whether we're flying.",at:"8:12 AM"},
      {who:"me",t:"Are you actually flying today? And is 235 lb going to be a problem?",at:"8:14 AM"},
      {who:"them",t:"We're flying - winds are 9 kt out of the east and the ceiling is clear, so loads are running every 25 minutes. 235 lb is under our 240 lb limit, so you're fine, but it gets weighed at manifest so don't round down. The 11:00 AM load has 4 slots open.",at:"8:14 AM"}
    ],
    "vx-cruiser":[
      {who:"them",t:"Gulf Coast Watersports. Ask about availability, pricing, or what to bring.",at:"9:02 AM"},
      {who:"me",t:"Do you have 3 skis Saturday around 11?",at:"9:03 AM"},
      {who:"them",t:"Saturday 11:00 AM has 3 skis open right now - that's $774 for the two-hour minimum before add-ons. Two riders per ski is comfortable, three is the legal max. Want me to hold them for 10 minutes?",at:"9:03 AM"}
    ]
  } as Record<string, ChatMessage[]>;
