# The availability corpus

Real booking systems, recorded once, replayed for ever, so that the availability reader in
`src/enrich/availability.ts` can be **scored** rather than trusted.

That reader answers the only question a guest really has: is there a seat at seven tonight, and what will it
cost. It answers it by reading whatever JSON each operator's booking widget reads, which means its correctness
depends on the undocumented shapes of nine other companies' feeds. Those shapes change without notice, and a
reader that has stopped understanding one does not crash: it returns `{ live: false }`, or worse, a plausible
and wrong list of times. Nothing on the page says so.

## Commands

| Command | Costs | What it does |
|---|---|---|
| `npm run avail:capture` | a polite crawl | Records real shops into `cases/`. 13 per vendor by default. |
| `npm test` | nothing | Replays every case offline. Part of the ordinary backend suite. |
| `npm run avail:report` | nothing | The accuracy table: rule checks, second-read agreement, truth. |
| `npm run avail:rebaseline` | nothing | After a deliberate fix, accept the new answers from the existing recordings. |
| `npm run avail:judge` | prints an estimate | What an independent model read would cost. Spends nothing. |
| `npm run avail:judge -- --yes` | **real money** | Submits it, and writes each case's `truth.json`. |

Capturing is a crawl and obeys the crawl rules: the single lock, the CPU floor, and a hard cap of 40 shops on
a Mac. A corpus over the whole catalog runs on the Render worker, where the cap does not apply:

```
npm run avail:capture -- --per-vendor=200
```

## What a case is

```
cases/<vendor>/<shop>/case.json          the window asked for, and what the reader answered at capture time
cases/<vendor>/<shop>/exchanges.json.gz  every request and response that answer was built from
cases/<vendor>/<shop>/truth.json         what the answer should have been, decided independently (optional)
```

The split between `observed` in `case.json` and `truth.json` is the point of the whole thing. `observed` locks
the reader against silent change, which is a regression test and says nothing about whether it was ever right.
`truth.json` is arrived at **without** the reader and is what accuracy is measured against. A suite that only
compares a reader to its own past output will certify a bug that has been there from the start.

## The four ways a case is judged, weakest last

1. **Rule checks** (`src/eval/availChecks.ts`, free, every test run). Fourteen things that must be true of any
   answer, each one a defect a guest would see: a midnight departure that is not flagged as a placeholder, a
   sold out slot still on sale, a price of zero shown as free, a time that appears nowhere in what the vendor
   sent. None of these needs an authority to decide.
2. **A second reading** (`crossRead`, free, every test run). The same recorded bytes read again by code written
   separately from the reader, with no budget, no cache and no item selection. Where the two differ, one is
   wrong. This catches transcription, filtering, dedup, budget and timezone mistakes, which is most of what
   goes wrong, and cannot catch a misunderstanding both readings share.
3. **An independent model** (`npm run avail:judge`, paid). A model is given the vendor's raw payload, with every
   field the vendor set left on each record, and never told what our reader answered. This is the only cheap
   way to catch the misunderstanding the second reading cannot, short of a person opening forty booking pages.
4. **Stability** (free, every test run). Does the reader still say what it said at capture? The weakest signal
   and still worth having: a vendor rewrite shows up here first.

## Two bugs this found on the day it was built

Both were live, both were invisible from the outside, and both were found by the free half.

**FareHarbor listed the same departure twice for a week at a time.** A FareHarbor month calendar is laid out in
whole weeks, so September 2026 answers with 30 August to 3 October and October with 27 September to 31 October.
Any window crossing a month boundary read the straddling week twice and added every departure in it twice.
Hawaii Glass Bottom Boats' 27 September came back as 38 rows that were 19 departures, the same 8:15 cruise
listed twice with the same seat count and the same book link. Roughly half of all fourteen day windows cross a
boundary. The duplicates also filled the forty-slot-a-day ceiling, so real later departures were being dropped
to make room for copies of earlier ones.

**Peek showed one departure four times at four different prices.** Peek answers with a row per bookable variant
of a timeslot, and for a rental that is one per duration. Bowen Island E-Bikes' eleven o'clock came back four
times: seven hours, one day, two days and three days, at $49, $98, $147 and $196. Our label is the activity's
name and our book link is the shop's one booking page, so a guest saw the identical line four times and three
of the prices were not the price of what they would get. Ten real departures filled the forty-row ceiling.

The first was caught with nine shops in the corpus. The second needed thirty-nine, which is the argument for
making it bigger.
