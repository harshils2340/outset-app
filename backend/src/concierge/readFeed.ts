import { fareharborLive, type LiveRead } from "./live.ts";
import { resovaLive } from "./resova.ts";
import { peekLive } from "./peek.ts";
import { checkfrontLive } from "./drivers/checkfront.ts";
import { xolaLive } from "./readers/xola.ts";
import { rezdyLive } from "./readers/rezdy.ts";
import { tripworksLive } from "./readers/tripworks.ts";
import { squareLive } from "./readers/square.ts";
import { acuityLive } from "./readers/acuity.ts";
import { foreupLive } from "./readers/foreup.ts";
import { readerFor } from "./readable.ts";

/**
 * Ask a shop's own booking system what is free, whichever system that is.
 *
 * `readable.ts` already exists because four places each kept their own copy of "which vendors can we read",
 * and three of them were narrower than the readers actually were. This is the same lesson one step along:
 * knowing the vendor is not the same as calling it, and the call was written out once, in `plan.ts`, behind a
 * closure nothing else could reach. So `liveFor` in `live.ts`, which is what `GET /concierge/live/:domain`
 * answers from, still tried FareHarbor and then Resova and gave up: a Peek shop was told "no feed to read"
 * on that route while the concierge quoted its real departures from the very same link.
 *
 * Every reader takes the same options and answers in the same shape, so the only thing worth keeping in one
 * place is the mapping, plus the two per-vendor budgets below that were tuned against real shops.
 */
export function readFeed(bookingUrl: string, opts: { from: Date; days: number; tz?: string | null }): Promise<LiveRead | null> {
  const { from, days, tz } = opts;
  switch (readerFor(bookingUrl)) {
    case "square":
      return squareLive(bookingUrl, { from, days, tz });
    case "acuity":
      return acuityLive(bookingUrl, { from, days, tz });
    case "tripworks":
      return tripworksLive(bookingUrl, { from, days, tz });
    case "xola":
      return xolaLive(bookingUrl, { from, days, tz });
    case "rezdy":
      return rezdyLive(bookingUrl, { from, days, tz });
    case "checkfront":
      return checkfrontLive(bookingUrl, { date: from, days, tz });
    case "peek":
      return peekLive(bookingUrl, { from, days, tz });
    case "resova":
      return resovaLive(bookingUrl, { from, days, tz, maxItems: 4 });
    case "foreup":
      return foreupLive(bookingUrl, { from, days, tz });
    case "fareharbor":
      /**
       * Six items, not three. Zoom Tours sells four day tours and we priced three of them, so the fourth
       * came back "price on request" and sat on the screen next to a headline that had no number to quote.
       * The total sheet is shared across a company's items, 287557 for every one of theirs, so the first
       * item costs three calls and each one after it costs two.
       */
      return fareharborLive(bookingUrl, { from, days, tz, maxItems: 6 });
    default:
      /**
       * No rule matched. FareHarbor used to be the fallback here, which meant every unreadable link was
       * handed to a reader that answers null for it anyway; saying so plainly lets the caller route the
       * shop to the browser agent instead of waiting on a parse that cannot work.
       */
      return Promise.resolve(null);
  }
}
