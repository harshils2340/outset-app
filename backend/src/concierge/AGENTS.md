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
| `feed` | the vendor answers in JSON, no browser | 1,441 FareHarbor links |
| hosted page | rebuild the vendor's own booking URL from the account id in the embed, drive one plain page | ~28% of links |
| `agent` | browser on the shop's own hand-built form | the long tail |
| `phone` | no booking system at all; call them | 325,229 operators have a number |

Measured on sixty real booking links, fetched for real: 35% name a vendor we recognise, 28% give up an account
id, 18% have a feed. **Fetching the unknown ones with a full browser finds exactly nothing more (8 of 14 either
way).** They are not vendors hidden behind JavaScript, they are hand-built forms and "call us" pages. Do not
spend a night re-testing this.

## Files

- `live.ts` — live availability. FareHarbor only so far: four public calls, no key. Calendar for the month,
  then per departure its customer types, the price sheet that applies online, and that sheet's totals.
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

## Things that were bugs, so you do not reintroduce them

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

- Booking is not real. The page shows the virtual-card step and a confirmation number but charges nothing.
  Stripe Issuing needs an application and approval, and is limited in Canada.
- Only FareHarbor has a live feed. Peek is 257 links and the next one worth doing.
- Bookeo blocks headless browsers outright; its widget never loads. Its account id is readable from the embed
  (`widget.js?a=...`) and its hosted page is the route to try, not the iframe.
