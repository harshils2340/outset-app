import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { displayHours } from "../hoursText";
import { hourLines, osmToLines, parseWeek } from "../openNow";

/**
 * The Hours block a guest reads on a listing, on the desktop page, in the phone sheet and in the "Plan your
 * visit" box of a walk-in listing. Every line below is one a real shop published.
 */

test("OpenStreetMap's own syntax is read out in words", () => {
  assert.deepEqual(displayHours(["Mo-Tu 10:00-18:00; We off; Th 10:00-18:00; Fr 09:00-17:00; Su off; PH off"]), [
    "Mon-Tue 10:00 AM - 6:00 PM",
    "Wed Closed",
    "Thu 10:00 AM - 6:00 PM",
    "Fri 9:00 AM - 5:00 PM",
    "Sun Closed",
    "Public holidays Closed",
  ]);
  // A clause the syntax does not cover is still the shop's own fact, so it is kept, without its quote marks.
  assert.deepEqual(displayHours(["Mo-Sa 10:00-19:00; Su \"by appointment\""]), ["Mon-Sat 10:00 AM - 7:00 PM", "Sun by appointment"]);
  assert.deepEqual(displayHours(["Fr,Sa 12:00-19:00; Su 12:00-16:00"]), ["Fri, Sat 12:00 PM - 7:00 PM", "Sun 12:00 PM - 4:00 PM"]);
});

/**
 * The three shapes of rule the reader used to give up on, so the day codes and the 24 hour clock went to a guest
 * as written: a span with one end the syntax names rather than clocks, a span the shop said more after, and a
 * rule that opens with the months or the date it applies to. 36 listings between them, and one of those, an
 * Apr-Dec sculpture garden, had its whole week dropped rather than printed.
 */
test("a rule that says more than a plain span is still read out in words", () => {
  assert.deepEqual(displayHours(["Mo-Su 07:00-sunset"]), ["Mon-Sun 7:00 AM - sunset"]);
  assert.deepEqual(displayHours(["Mo-Su sunrise-22:00"]), ["Mon-Sun sunrise - 10:00 PM"]);
  assert.deepEqual(displayHours(["Mo-Su sunrise-sunset"]), ["Mon-Sun sunrise - sunset"]);
  assert.deepEqual(displayHours(["Su 13:30-16:00 \"or by appointment\""]), ["Sun 1:30 PM - 4:00 PM or by appointment"]);
  // Two spans in one rule, and the syntax's own comma in front of the shop's words, are the syntax's, not theirs.
  assert.deepEqual(displayHours(["Mo-Fr 10:00-17:00,17:00-19:00 \"by appointment\""]), ["Mon-Fri 10:00 AM - 5:00 PM, 5:00 PM - 7:00 PM by appointment"]);
  assert.deepEqual(displayHours(["Tu 09:00-15:00, \"by appointment\""]), ["Tue 9:00 AM - 3:00 PM by appointment"]);
});

test("the months a rule applies to are the shop's season, not the syntax's keyword", () => {
  assert.deepEqual(displayHours(["May-Oct Mo-Sa 09:00-16:00; Nov-Apr Mo,We 10:00-15:00"]), [
    "May-Oct Mon-Sat 9:00 AM - 4:00 PM",
    "Nov-Apr Mon, Wed 10:00 AM - 3:00 PM",
  ]);
  assert.deepEqual(displayHours(["Apr-Dec Mo-Sa 09:00-17:00, Su 11:00-16:00; Jan-Mar \"by appointment only\""]), [
    "Apr-Dec Mon-Sat 9:00 AM - 5:00 PM",
    "Sun 11:00 AM - 4:00 PM",
    "Jan-Mar by appointment only",
  ]);
  assert.deepEqual(displayHours(["Sa-Su 11:00-17:00; Jan-Feb off; Dec off"]), ["Sat-Sun 11:00 AM - 5:00 PM", "Jan-Feb Closed", "Dec Closed"]);
  assert.deepEqual(displayHours(["Fr-Sa 12:00-18:00; Dec 25 off"]), ["Fri-Sat 12:00 PM - 6:00 PM", "Dec 25 Closed"]);
  // One date range written around another is not one rule, so it stays the clause that is dropped whole.
  assert.deepEqual(displayHours(["May Mo[-1] -2 days-Sep Mo[1] Sa,Su 09:00-18:30 || Sa,Su 09:00-18:30 \"by appointment\"; PH Off"]), [
    "Sat, Sun 9:00 AM - 6:30 PM by appointment",
    "Public holidays Closed",
  ]);
});

test("a sentence that happens to start with a day code is left as the shop wrote it", () => {
  assert.deepEqual(displayHours(["We work daily from 10 am to 9 pm"]), ["We work daily from 10 am to 9 pm"]);
  assert.deepEqual(displayHours(["Sat - Sun 9:00 AM - 5:00 PM"]), ["Sat - Sun 9:00 AM - 5:00 PM"]);
});

test("a day the crawl ran onto the end of a time gets its own line", () => {
  assert.deepEqual(displayHours(["Sun - Thur: 11am - 11pmFri - Sat: 11am - 1am"]), ["Sun - Thur: 11am - 11pm", "Fri - Sat: 11am - 1am"]);
  assert.deepEqual(displayHours(["Wednesday 2:00pm- 7:00pmThursday 11:00am- 6:00pm"]), ["Wednesday 2:00pm- 7:00pm", "Thursday 11:00am- 6:00pm"]);
  // A date before a day name is not a time before a day name.
  assert.deepEqual(displayHours(["May 5 - June 2 Sunday 10am-4pm"]), ["May 5 - June 2 Sunday 10am-4pm"]);
});

test("the punctuation the crawl swept up in front of the hours is not part of them", () => {
  assert.deepEqual(displayHours([") (6am-4pm"]), ["6am-4pm"]);
  assert.deepEqual(displayHours(["* Monday: 12:00pm - 11:00pm"]), ["Monday: 12:00pm - 11:00pm"]);
  assert.deepEqual(displayHours(["\"by appointment\""]), ["by appointment"]);
  assert.deepEqual(displayHours(["​ Sunday - Thursday - 4pm to 12am"]), ["Sunday - Thursday - 4pm to 12am"]);
  // A zero-width space inside a word is why "Monday to Friday" was one word short of searchable.
  assert.deepEqual(displayHours(["Monday t​o Friday, 8:30am to 4:30pm"]), ["Monday to Friday, 8:30am to 4:30pm"]);
});

test("a heading is not an hour, a happy hour is not a trading hour, and one line is printed once", () => {
  assert.deepEqual(displayHours(["Hours of Operation: Mon - Fri8:00 am - 5:00 pm"]), ["Mon - Fri 8:00 am - 5:00 pm"]);
  // 38 shipped lines open on a heading word that names nothing, straight into the days or the clock.
  assert.deepEqual(displayHours(["Schedule Mon: 9:00 AM - 3:00 PM"]), ["Mon: 9:00 AM - 3:00 PM"]);
  assert.deepEqual(displayHours(["Open Hours Mon-Thu 8am-5pm"]), ["Mon-Thu 8am-5pm"]);
  assert.deepEqual(displayHours(["Store Hours Mon Closed"]), ["Mon Closed"]);
  assert.deepEqual(displayHours(["REGULAR HOURS: 8:30 am - 4:30 pm"]), ["8:30 am - 4:30 pm"]);
  assert.deepEqual(displayHours(["Time: 5:00pm - 7:30pm"]), ["5:00pm - 7:30pm"]);
  assert.deepEqual(displayHours(["Hours:Monday - Friday - 9AM - 6PM"]), ["Monday - Friday - 9AM - 6PM"]);
  // A calendar emoji in front of the heading is what kept the heading on o-3palmszoo-org's line, and its
  // Monday was then printed twice, once with the heading and once without.
  assert.deepEqual(displayHours(["\u{1F5D3}\u{FE0F} Schedule Mon: 9:00 AM - 3:00 PM", "Mon: 9:00 AM - 3:00 PM"]), ["Mon: 9:00 AM - 3:00 PM"]);
  // And punctuation the other side of it: the crawl stored this line as "of operation? The course is open".
  assert.deepEqual(displayHours(["of operation? The course is open 6:00 AM - 11:00 PM"]), ["The course is open 6:00 AM - 11:00 PM"]);
  // Whose hours they are is a fact, and a heading followed by a sentence is the sentence's own first words.
  assert.deepEqual(displayHours(["Office hours 12-7 pm"]), ["Office hours 12-7 pm"]);
  assert.deepEqual(displayHours(["Park Hours 3:00pm - 10:00pm during event days"]), ["Park Hours 3:00pm - 10:00pm during event days"]);
  assert.deepEqual(displayHours(["open hours on Wednesdays and Saturdays from 1 PM to 4:30 PM"]), ["open hours on Wednesdays and Saturdays from 1 PM to 4:30 PM"]);
  assert.deepEqual(displayHours(["Opening Friday 10:00 am"]), ["Opening Friday 10:00 am"]);
  assert.deepEqual(displayHours(["Happy Hour Wednesday-Friday 12-6 PM"]), []);
  assert.deepEqual(displayHours(["Daily 9am-5pm", "Daily 9am-5pm"]), ["Daily 9am-5pm"]);
  assert.equal(displayHours([""]).length, 0);
});

test("a shop that shouts its hours still states its hours", () => {
  assert.deepEqual(displayHours(["SUNDAY-WEDNESDAY 12-11pm"]), ["SUNDAY-WEDNESDAY 12-11pm"]);
});

/**
 * The same rule `coversWholeDay` applies in openNow.ts, on the surface that prints the hours rather than the one
 * that answers "open now". 166 shipped listings publish a site builder's placeholder span, and every one of them
 * showed nothing at all in the open-or-closed line while this block said they never shut.
 */
test("a span covering the whole day is a site builder's placeholder, not hours", () => {
  assert.deepEqual(displayHours(["Mon-Sun 12:00 AM - 11:59 PM"]), []);
  assert.deepEqual(displayHours(["Mo-Su 00:00-24:00"]), []);
  assert.deepEqual(displayHours(["Mo-Fr 00:00-23:59"]), []);
  // One placeholder day does not take the days beside it that the owner really did set.
  assert.deepEqual(displayHours(["Mon 12:00 AM - 12:00 AM", "Tue 9:00 AM - 5:00 PM"]), ["Tue 9:00 AM - 5:00 PM"]);
  // A shop saying it round the clock in words has stated something, so it keeps its line.
  assert.deepEqual(displayHours(["Mon - Sun: 24 Hours"]), ["Mon - Sun: 24 Hours"]);
  assert.deepEqual(displayHours(["Open 24/7"]), ["Open 24/7"]);
  // A real span that only touches midnight at one end is a real span.
  assert.deepEqual(displayHours(["Daily 12:00 AM - 8:00 AM"]), ["Daily 12:00 AM - 8:00 AM"]);
  assert.deepEqual(displayHours(["Mon 11:00 AM - 12:00 AM"]), ["Mon 11:00 AM - 12:00 AM"]);
  assert.deepEqual(displayHours(["Sun 12:00 PM - 11:59 PM"]), ["Sun 12:00 PM - 11:59 PM"]);
  // The same placeholder written from somewhere other than midnight: two ends naming one clock face. 5 lines
  // across 5 shipped listings, and the parser refuses each of them too, so the day keeps its honest gap.
  assert.deepEqual(displayHours(["Mon-Sun 1:00 AM - 1:00 AM"]), []);
  assert.deepEqual(displayHours(["Sat 12:00 PM - 12:00 PM"]), []);
  assert.deepEqual(displayHours(["Wed 8:00 AM - 8:00 AM"]), []);
  assert.deepEqual(displayHours(["Sun 11:00 AM - 11:00 AM"]), []);
  // Only its own day: SaltWater Brewery publishes six real ones beside it.
  assert.deepEqual(displayHours(["Sat 12:00 PM - 12:00 PM", "Sun 12:00 PM - 10:00 PM"]), ["Sun 12:00 PM - 10:00 PM"]);
  // Two ends an hour apart are not one clock face, whatever they share.
  assert.deepEqual(displayHours(["Sun 11:00 AM - 11:00 PM"]), ["Sun 11:00 AM - 11:00 PM"]);
  assert.deepEqual(displayHours(["Sun 11:00 AM - 11:30 AM"]), ["Sun 11:00 AM - 11:30 AM"]);
});

/**
 * Over every listing that ships: nothing a guest reads under Hours may carry the syntax, the marks or the
 * invisible characters the crawl brought with it, and what is printed must still be the week the rest of the
 * page reads.
 */
test("the whole shipped catalog reads clean under Hours", () => {
  const dir = "public/o";
  const files = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
  if (!files.length) return;
  const bad: string[] = [];
  const drift: string[] = [];
  const INVISIBLE = new RegExp("[" + String.fromCharCode(0) + "-" + String.fromCharCode(31) + "​-‏﻿]");
  for (const f of files) {
    const item = JSON.parse(fs.readFileSync(dir + "/" + f, "utf8"));
    const own = hourLines(item);
    const source: string[] = own.length ? own : (item.contact?.hours ?? []);
    if (!source.length) continue;
    const shown = displayHours(source);
    for (const line of shown) {
      if (/["“”]/.test(line) || INVISIBLE.test(line) || /^[^\p{L}\p{N}]/u.test(line) || /\boff\s*;|;\s*PH\b|\|\|/.test(line)) bad.push(item.id + " :: " + line);
    }
    // Reading the syntax out in words may not change the days it states. Line by line, and against
    // `osmToLines`, which is how the same syntax reaches the week parser: what a guest reads and what the
    // page reads come from one set of rules. Only printed lines naming a weekday count, because a span with
    // no day at all ("Public holidays 12:00 PM - 6:00 PM") is every day to the parser.
    for (const line of source) {
      const asRules = osmToLines(line);
      if (!asRules.length) continue;
      const parsed = parseWeek(asRules);
      const printed = parseWeek(displayHours([line]).filter((l) => /\b(mon|tue|wed|thu|fri|sat|sun)/i.test(l)));
      for (let d = 0; d < 7; d++) {
        const a = parsed?.[d];
        if (!a || !printed) continue;
        if (JSON.stringify(a) !== JSON.stringify(printed[d])) drift.push(item.id + " day " + d + "\n  from: " + line + "\n  week: " + JSON.stringify(a) + "  printed: " + JSON.stringify(printed[d]));
      }
    }
  }
  assert.deepEqual(bad.slice(0, 5), [], bad.length + " listings print something under Hours that no shop wrote");
  assert.deepEqual(drift.slice(0, 3), [], drift.length + " printed lines state a different day from the week parser");
});

/**
 * The block a guest reads is the shop's own words, and a shop that wrote two rules with a space between them
 * wrote one line. The week behind that line is cut into its rules (see openNow.test.ts); the printed line is
 * not, because there is no crawl seam in it to tidy away. Only the crawl's own glued seams become two lines.
 */
test("a shop's own spacing is left in the line a guest reads", () => {
  assert.deepEqual(displayHours(["Mon-Sat 10am - 5pm Sunday 12pm - 5pm"]), ["Mon-Sat 10am - 5pm Sunday 12pm - 5pm"]);
  assert.deepEqual(displayHours(["MondayClosedTuesday2:00PM to 7:00PM"]), ["Monday Closed", "Tuesday 2:00PM to 7:00PM"]);
  // The same line, read for the week rather than for print, is the two rules it holds.
  assert.equal(parseWeek(["Mon-Sat 10am - 5pm Sunday 12pm - 5pm"])?.[0]?.open, 720);
});

/**
 * The days a shop wrote as a code rather than a word, on the guest side of the twin. Every line below is one a
 * real shop published, and every one of them was misread: "M-F 9am-5pm" named no day at all, which the week
 * reads as every day of it, so 34 listings stood open on a Sunday their own site says they are shut. The
 * backend's `encodeWeek` carries the same cases, because a card and the page it opens have to agree.
 */

const codedWeek = (line: string) =>
  (parseWeek([line]) || []).map((d, i) => "SMTWTFS"[i] + (d ? d.open + "-" + d.close : "-")).join(" ");

test("a week written in one and two letter codes is read the way the shop wrote it", () => {
  assert.equal(codedWeek("M-F 9am-5pm"), "S- M540-1020 T540-1020 W540-1020 T540-1020 F540-1020 S-");
  assert.equal(codedWeek("Mo-Fr: 5am - 7pm"), "S- M300-1140 T300-1140 W300-1140 T300-1140 F300-1140 S-");
  assert.equal(codedWeek("Sa-Sun: 7 AM - 10 PM"), "S420-1320 M- T- W- T- F- S420-1320");
  assert.equal(codedWeek("M, Tu, We, Sa: 6:00 AM - 8:00 PM"), "S- M360-1200 T360-1200 W360-1200 T- F- S360-1200");
  assert.equal(codedWeek("M - F 10am - 6pm Saturday 10am - 3pm"), "S- M600-1080 T600-1080 W600-1080 T600-1080 F600-1080 S600-900");
});

test("a code that means two days, and a lone letter, name no day at all", () => {
  // "T" is Tuesday or Thursday, "S" is Saturday or Sunday: a guess either way, so the line keeps the week it
  // had. And a single letter by itself is as likely to be a month or a street direction as a day.
  assert.equal(codedWeek("M-T: 8:00AM - 5:30PM"), "S480-1050 M480-1050 T480-1050 W480-1050 T480-1050 F480-1050 S480-1050");
  assert.equal(codedWeek("S-S 9am-3pm"), "S540-900 M540-900 T540-900 W540-900 T540-900 F540-900 S540-900");
  assert.equal(codedWeek("Peak Season 9AM - 9PM, Mid Season 10AM - 7PM"), "S540-1260 M540-1260 T540-1260 W540-1260 T540-1260 F540-1260 S540-1260");
});

test("the words a guest reads in the Hours block keep the shop's own codes", () => {
  // The cut above is a reader, not a rewrite: nothing on the page changes.
  assert.deepEqual(displayHours(["M - F 10am - 6pm Saturday 10am - 3pm"]), ["M - F 10am - 6pm Saturday 10am - 3pm"]);
  assert.deepEqual(displayHours(["M-F 9am-5pm"]), ["M-F 9am-5pm"]);
});
