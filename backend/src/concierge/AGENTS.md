# concierge

Read `/AGENTS.md` and `backend/AGENTS.md` first. This file is the whole context for the concierge, which is the
newest part of the product and the one a fresh session is most likely to be asked to work on.

## What this is

One sentence in, real bookable options out. "escape room in waterloo tonight, 4 of us" becomes a shortlist of
real businesses with real times and real prices, read from each shop's own booking system while the guest waits.

It exists because the catalog answers "who is there" and a guest asks something harder: "is there a seat at
seven tonight, and what will it cost me". No crawl can answer that. The answer changes by the minute and lives
inside whatever booking software the shop happens to run.

## The four ways a booking can be fulfilled

A guest never sees which one their booking took. They do see whether we can quote a time, so the ones we can
answer for are offered first.

| route | how | how many |
| --- | --- | --- |
| `feed` | the vendor answers in JSON, no browser | 1,441 FareHarbor + 16 Resova links |
| hosted page | rebuild the vendor's own booking URL from the account id in the embed, drive one plain page | ~28% of links |
| `agent` | browser on the shop's own hand-built form | the long tail |
| `phone` | no booking system at all; call them | 325,229 operators have a number |

Measured on sixty real booking links, fetched for real: 35% name a vendor we recognise, 28% give up an account
id, 18% have a feed. **Fetching the unknown ones with a full browser finds exactly nothing more (8 of 14 either
way).** They are not vendors hidden behind JavaScript, they are hand-built forms and "call us" pages. Do not
spend a night re-testing this.

## The conversation

`/concierge/ask` and `/concierge/stream` both take a `session` id and return one. The agent keeps the intent it
has accumulated against that id, so a sentence is merged into what it already knew rather than replacing it:
"escape room tonight" → asked where → "waterloo" keeps the escape room and the tonight. Said-or-not is the
test, never truthiness, because party defaults to two and a later sentence that does not count heads must not
overwrite a party of six. `POST /concierge/reset` clears it. Sessions are in memory with a two-hour TTL
(`session.ts`); they are worth nothing an hour later and not worth a table.

## Answer first. A question in front of an answer is a form.

`followUp` blocks and is reserved for the one thing that cannot be worked around: no place at all. Everything
else — which genre, what budget — arrives as `narrow`, the same shape, but *beside* `options` rather than
instead of them.

This was learned the hard way. "Help me plan a team offsite with a $500 budget and 10 people for Monday
between 5-7pm near me" carries party, budget, day, a time window and a place, and it came back as four chips
and no businesses because no single activity had been named. That reads as the product refusing to listen, and
it was right to read it that way. A question costs the guest a turn; a shortlist they can push back on costs
nothing, and the refinement verbs below make pushing back free.

Measured over eight varied sentences: one blocks, and only because it named no place at all.

## The funnel: narrow beside the answer, then keep refining

Most of what people type is not a search. "Date activities near me" names no place, no activity and no budget,
and no ranking turns it into a good answer. So the agent narrows first, one question per turn, in the order
where each answer changes the next question:

1. **Where.** The only blocking question: nothing can be searched without it, and both the genres worth offering and the
   prices worth asking about are properties of a town. The choices are the towns with the most businesses, so
   the question works in all 52 states and provinces rather than offering three Ontario examples.
2. **Which town**, when the name is not unique. Eleven places here are called Waterloo and the old code took
   the biggest, quietly sending guests near Waterloo, Iowa a list a thousand kilometres away. Only asked when
   the runner-up is real: at least 3 businesses and a fifth of the leader, so a 105-to-3 split is not a
   question.
3. **What sort of thing**, offered beside the answer when no activity was named, never in front of it. Sixty-four categories is a menu, not a question, so
   they are grouped into seven genres ("Something active", "On the water", "Puzzles and games"…) and only the
   genres that actually have businesses near that point are offered, with the real counts behind them.
4. **Budget**, also beside the answer, and only when it would change one: the dearest at least double the cheapest and at
   least $25 between them. Asking about three escape rooms charging $32, $33 and $34 wastes a turn. The
   figures offered are cut at the third and the seventieth percentile of what was actually found, rounded to
   a number a person would say — never the literal minimum, which narrows to one odd cheap line.
It always searches, and always asks the shops themselves, whatever it is offering to narrow.

`intent.asked` carries what has already been put to them, so nothing is asked twice; "doesn't matter" is heard
as an answer to the budget question and closes it. Everything not asked about is assumed and said out loud:
party of two, any time in the next fortnight.

## After the answer

The conversation does not stop at the first list. `intent.refine` reads what they want done to the answer they
already have, and applies it before anything is searched again:

- **"something else"** — `intent.seen` holds every domain already shown, and they are excluded from the query.
- **"anything cheaper"** — the cap drops to 70% of itself, or to the cheapest thing last shown when no budget
  was ever given.
- **"check again"** — the shops are asked afresh and `seen` is cleared.
- **"earlier" / "later"** — shifts the clock time by an hour and a half.

All of it merges into the intent rather than replacing it, so a guest six turns in has not lost the town, the
activity or the party size.

**Nothing found** still offers the nearest towns that do have it, rather than a dead end.

Everything else is assumed and said out loud: party of two, any time in the next fortnight. A silent guess is
indistinguishable from a fact.

Every question carries its answers (`followUp.choices`), each one a sentence that goes back through the same
reader. A question with an empty box is a form.

## Watching it work

`plan()` takes a `Trace` and emits a step as each thing happens: what it read, what it carried from earlier,
what it assumed, which shops it asked and what each answered, what it skipped and why, what it dropped for
being over budget. `/concierge/stream` is the same answer over server-sent events, so the panel on `/go` shows
the agent's real order and real timings rather than a tidy retelling drawn from the finished answer.
`/sessions` is every conversation this process has served, step by step, newest first — a phone in somebody's
hand and this on the laptop beside it.

## A time, not just a day

"escape room at 4:30pm" is a different request from "escape room tonight": they have dinner at six. When the
sentence names a clock time (`4:30pm`, `430pm`, `16:30`, `at 7` — evening is assumed under nine, because
nothing here opens at seven in the morning), departures are ordered by the soonest day and then by distance
from that time, and each carries a signed `offset` in minutes. The card says "1h 30m earlier" and where the
time came from, because an offer that quietly slides four hours is how somebody misses their dinner.

A bare number is only a time when the sentence points at one: "for 4" is a party and "$40" is money.

## The crawler is told what to crawl

`demand.ts`. Every answered question writes down the businesses that were shown and could not be priced, and
the category-and-town pairs people keep asking about. `pendingStructure` takes that list first and falls back
to its old order when nobody has asked for anything, so a cold pipeline behaves exactly as it did.

It exists because the old queue was `(metro_id IS NULL), review_count DESC NULLS LAST, name ASC` and only
35,844 of 423,161 operators carry a review count — so for 92% of a 315,284-site backlog it collapsed to
`name ASC`, an alphabetical march through the catalog. Meanwhile the concierge knew exactly which businesses a
real person had just been shown and could not be quoted a price for, and nothing was doing anything with it.

## Things that were bugs, so you do not reintroduce them (crawl side)

- **A range means when it starts.** "Monday between 5-7pm" read 19:00, because the last time in the sentence
  won, so every slot was ranked around the moment the offsite was due to finish.
- **A shop we cannot read is not a shop that takes bookings by phone.** Bad Axe, Lumberjacks and Riot Axe all
  sell online right now — date step, guest count, Pay button — on hand-built forms we have no reader for.
  Saying "we would call them" about them is not a limitation being admitted, it is a false statement about a
  real business. `route: "agent"` means "sells online, no reader yet"; `route: "phone"` means "no booking page
  found at all". They are different and must read differently.

## How far "read the widget" can actually go

Every shop with a booking widget has availability behind it, so in principle every one of them is readable.
Measured, on 20 September 2026, the ground is this:

| what | links | state |
| --- | --- | --- |
| FareHarbor | 1,441 | readable today |
| Resova | 17 | readable today |
| Peek | 257 | one reader away, and the biggest single win |
| Xola, Square, Bookeo, Rezdy, TripWorks, Checkfront, Eventbrite, Acuity, Roller, Calendly, Setmore, Mindbody, Zaui | 315 | a reader each |
| the shop's own page | 9,016 | see below |

**The 9,016 are not all hand-built.** `booking_url` is classified by pattern-matching the URL string, and a
shop whose booking link is `theirdomain.com/book` very often embeds a vendor on that page. A sample of 36 of
them, fetched for real: 31 answered, and **8 of those (26%) carry a known vendor's widget in the HTML** —
three of them FareHarbor, which we can already read. Eighteen have a booking flow of their own with no vendor
behind it, and five had no visible flow at all.

So the order of work, cheapest first:

1. **Re-sniff the 9,016 from the page, not the URL.** One free crawl. On the sample's rate that identifies
   roughly 2,300 more vendor embeds, of which around 870 are FareHarbor and become readable with no new code
   at all.
2. **A reader per vendor**, Peek first. Each is about a day and the shape is set: see `resova.ts`, which took
   `/misc/init` plus `/availability/times` and nothing else.
3. **Sniff the endpoint, then replay it.** `sniff.ts` and `scripts/sniff-endpoints.mts`. This is the answer
   to the own-flow tail and it turns out not to be the long pole at all.

   A calendar that shows a guest which times are free had to fetch that list from somewhere. There is always a
   request; it is only that we could not guess it. So open the page in a headless browser, click the most
   booking-looking control, and record every request whose answer carries slot-shaped times and prices. Keep
   the URL and throw the browser away: the second read of that shop is a plain fetch of an endpoint we now
   know, as cheap as FareHarbor's, on a business that never published an API.

   Discovery is slow and happens once per shop, on the worker. Reading is fast and happens while a guest
   waits. That split is the whole idea.

   Measured on the first seventeen pages, every one of them previously filed as unreadable:

   | shop | what was actually behind the widget |
   | --- | --- |
   | badaxethrowing.com | `/wp-json/badaxe/v1/location/list/` — their own WordPress API. 30 times, $33.99 and $42.99 |
   | iflytoto.com | `POST flytoto.rezdy.com/availabilityAjax` — Rezdy, which we hold 36 links for |
   | niagarafallscanadatours.com | their own booking subdomain. 08:15 to 15:15, $19 to $40 |
   | cruisetoronto.com | `gls.ordersecuretickets.com` — a vendor we had never heard of |
   | exituser.com | a Wix booking block. 08:30 to 22:00, $31 to $45 |
   | lumberjacksaxethrowing.com | **FareHarbor.** We have read FareHarbor for months. It was filed as hand-built because its booking link was its own page |
   | riotaxe.com | `schedulista.com/schedule/widget` — another unknown vendor |

   So it does three jobs at once: cracks genuinely custom systems, reclassifies shops we had misfiled, and
   names the vendors worth writing a proper reader for — a host that keeps recurring in the results is the
   next `resova.ts`.

   Three of the ten in that run found nothing, and said so rather than inventing a candidate. A clock value is
   not a slot: Granite Brewery scored on "00:00 04:08 11:37 21:42 23:59", which is five timestamps, so times
   now have to fall in trading hours and land on a neat five minutes to count.

4. **The browser agent** remains for whatever is left after all of that. `book-agent.mts` exists and does not
   yet reliably reach a calendar, and it is now needed for far fewer shops than it looked.

Note this does not contradict the sixty-link finding above. That one compared a full browser against a plain
fetch and found nothing extra. This one compares reading the page against guessing from the URL, and finds a
quarter more.

## Checking it against the real world

`npx tsx scripts/truth.mts` compares what the agent says with what the operator's own booking page says,
from hand-recorded cases in `data/truth/*.json`. Everything else in this repository checks our code against our
code. Five checks per case: found, place, price, times, and **nearest** — asked for a clock time half an hour
off one of their real slots, does it offer the closest one the shop actually sells, or the first of the day? It
exits non-zero on a mismatch. Record what the page literally showed; a guess in a truth file is a wrong test
that fails working code.

Two cases so far, both Waterloo-region escape rooms and both without a readable feed, which is the point:
Escapology (Resova) and Adventure Rooms (Checkfront). The harness says "no feed for checkfront" rather than
inventing a time.

Watch the price check on Adventure Rooms. It passes on $42 against their real $44, inside the 5% tolerance,
but the $42 we hold is labelled "Sabotage escape room **Niagara Falls**" — a different location of the same
brand, on the Kitchener row. That is the chain problem below, and the tolerance is hiding it.

## Files

- `live.ts` — live availability, and the shape both feeds answer in. FareHarbor: four public calls, no key.
  Calendar for the month, then per departure its customer types, the price sheet that applies online, and
  that sheet's totals.
- `resova.ts` — the second feed. `/misc/init` for the rooms, `/availability/times/<item>?date=` for the day.
  Escapology runs Resova at all 25 of its locations.
- `plan.ts` — the sentence reader and the shortlist. What, where, when, how many, budget. Then the catalog,
  then the shops themselves.
- `vendors.ts` — sixteen booking vendors: how to recognise each, how to pull the shop's account id out of the
  embed, and how to rebuild the vendor's hosted booking page from it.
- `../api/concierge.ts` — the two routes, and `/go`, the page.
- `../api/conciergePage.ts` — the page itself, one string, no build step.
- `../../scripts/demo-server.mts` — runs the concierge alone. The real API will not boot without Postgres,
  Stripe and a mail key; the concierge needs none of them.
- `../../scripts/book-agent.mts` — the browser agent for shops with no feed. Reads the widget; does not yet
  reliably reach a calendar.
- `session.ts` — the conversation and the trace of what the agent did inside it.
- `../api/sessionsPage.ts` — `/sessions`, the window over the agent's shoulder.
- `../../scripts/truth.mts`, `../../data/truth/` — the agent against the operators' own pages.
- `sniff.ts`, `../../scripts/sniff-endpoints.mts` — finding the availability endpoint behind a widget that
  has no API we know of, by watching what the widget itself asks for. Headless, and capped on a laptop.
- `demand.ts` — what guests asked for and we could not quote, fed back to the crawler.

## Things that were bugs, so you do not reintroduce them

- **Resova answers `200` with HTML for any path it does not know.** Only `/misc/init` and
  `/availability/times` return JSON; `/items`, `/item_categories` and the rest fall through to the Angular
  shell. A reader that trusts `res.ok` gets a page of markup where it expected a list, so the body is checked
  for a JSON opening character, not the status code.
- **Resova publishes two prices that disagree.** An item's `from.price` is the teaser on the room tile
  ($18.00 for "Who Stole Mona"); the slot's own `pricing_categories` is what their checkout charges ($37.00 a
  player for the same room). Quote the slot. This is the same class of error as FareHarbor's pre-tax total.
- **A slot that already started today is not availability.** Resova returns the whole day whatever the hour,
  so a guest asking at eight in the evening was offered noon. Today is filtered against the wall clock, and a
  room whose remaining slots have all passed falls through to tomorrow.

- **`inferCategory` matched its ids as bare substrings.** "Something relaxed" contains "axe", so an offsite
  brief came back as axe throwing; "Orange County Boat Tours" contains "range" and classified as a shooting
  range. It now needs a word boundary in front, which keeps "escaperoom" written as one word and drops the
  accidents.
- **A group budget is not a ticket price.** "$2,000 for 20 people" was read as a $2,000 cap per head, which
  excludes nothing. A total is divided by the party. And the cap has to bite on menu prices too, not only on
  feed departures: it was read, printed back to the guest, and then a $207.70 helicopter seat was offered
  under it.
- **A whole-room price is not a per-head price.** "Escape Rooms, $250" is a private booking, and quoting it as
  a ticket put "$32 to $250 a head" on the screen for Kitchener where the real spread is $32 to $37. Menu
  prices are classified by their unit ("/group", "/room") or by sitting above four times that category's own
  median, and group prices are kept out of the comparison and labelled "for the room".
- **One shop's menu is not another's.** Bingemans runs an escape room, an axe range and a campsite off one
  website, so the escape room was answered with "Axe Throwing, $99". A menu line that confidently names a
  different activity is dropped.
- **16% of booking links point somewhere else.** 1,820 of 11,046, including LinkedIn, MLB.com, and for
  BreakOut Escapes a rival axe-throwing company's home page. Links to hosts that never take bookings, or that
  are another operator's own domain, are dropped and the shop becomes a phone call. Check known vendor hosts
  *first*: two rows in this catalog are keyed by a vendor's domain ("Schooner Adventure" under
  `fareharbor.com`), so an other-operator test that runs first silently turns off every live feed.
- **One slow vendor held the whole answer.** An offsite query took twenty-two seconds because one helicopter
  operator's calendar was slow. There is a deadline per shop; whoever is late is left out.

- **Dates are local, never UTC.** `toISOString()` is five hours ahead of Eastern, so after eight in the evening
  "tomorrow" silently became the day after and the flight the guest asked about was never offered.
- **FareHarbor prices exclude tax** and say so: `price_previews.details.include_taxes` is `false`. Their
  checkout showed $114.30 where the API said $99.51. Every departure carries `taxIncluded` and the answer says
  "+ tax". Do not quote the bare number.
- **The cheapest ticket is often one a guest cannot buy.** Child, senior and student fares are only the
  headline when nothing else is sold. Same for menus: school rates, corporate days, gift cards and private hire
  are filtered out, because "School Trip 24-50 students, $25 each" is not a night out.
- **A place is a point, not a word.** Matching `city = 'Waterloo'` found nothing; the escape rooms a Waterloo
  student goes to are filed under Kitchener. Place names become coordinates and everything is measured in
  kilometres.
- **A province is not a town of the same name.** "skydiving in ontario" was offering a dropzone in Perris,
  California.
- **`inferCategory` answers `jetski` when nothing matched**, so a miss looks like a hit. It also only knows root
  words: it has never heard of "skydiving". The sentence is tried as typed and with English's endings removed,
  and a jet ski answer is only believed when the sentence says jet ski.
- **Ask the shops in parallel.** Three in turn took nineteen seconds with the machine idle throughout.

## What it does when it cannot answer

Never an empty screen. It asks for the one thing it is missing ("where are you? a town or city is enough"),
widens from forty kilometres to a hundred and twenty and says so, or offers what the place does have instead of
the activity that is not there. If no shop has a live feed it still prices them from the menu our crawl read
off their own site.

## The line that matters

It compares. "Axe throwing near Kitchener: $19.99 to $25 a head across 3 places." Those prices sit on a dozen
separate websites behind a dozen different booking widgets, and nobody compares them because nobody can. That
is the answer to why a guest would use this instead of a search engine.

## Not done

- **A chain collapses into one row.** `operators.domain` is UNIQUE, so every location of a brand that shares a
  website has to fit in a single row, and the fields come from whichever page was crawled last. The
  `escapology.com` row names Tampa, carries a North Carolina phone, a Waltham email and an address in Madison,
  Alabama. It is why Escapology Waterloo was missing entirely, and why Adventure Rooms' Kitchener row quotes a
  Niagara Falls price. Escapology Waterloo was added by hand as `escapology.com/waterloo-canada`; a
  location-scoped domain key is the shape a real fix would take.
- Booking is not real. The page shows the virtual-card step and a confirmation number but charges nothing.
  Stripe Issuing needs an application and approval, and is limited in Canada.
- FareHarbor and Resova have live feeds. **Peek is 257 links and the next one worth doing**, then Checkfront,
  which Adventure Rooms runs and which the truth harness currently fails on.
- **Escapology's $82.** Their widget showed a subtotal of $82.00 where their own API reports $37.00 a player
  pre-tax, and two tickets is $74. The $8 is tax or a fee we have not identified, and the harness reports it
  as unreconciled rather than guessing. One look at their real checkout settles it.
- **Party size is read but not enforced against capacity.** Resova gives every slot its `min_quantity` and
  `max_quantity` (Batman takes 2-4, Mansion Murder 2-6), and a party of six is still offered the four-player
  room. The numbers are already on every `Departure.rates` entry; nothing filters on them yet.
- Bookeo blocks headless browsers outright; its widget never loads. Its account id is readable from the embed
  (`widget.js?a=...`) and its hosted page is the route to try, not the iframe.
