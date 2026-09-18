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

test("a sentence that happens to start with a day code is left as the shop wrote it", () => {
  assert.deepEqual(displayHours(["We work daily from 10 am to 9 pm"]), ["We work daily from 10 am to 9 pm"]);
  assert.deepEqual(displayHours(["Sat - Sun 9:00 AM - 5:00 PM"]), ["Sat - Sun 9:00 AM - 5:00 PM"]);
});

test("a day the crawl ran onto the end of a time gets its own line", () => {
  assert.deepEqual(displayHours(["Sun - Thur: 11am - 11pmFri - Sat: 11am - 1am"]), ["Sun - Thur: 11am - 11pm", "Fri - Sat: 11am - 1am"]);
  assert.deepEqual(displayHours(["Wednesday 2:00pm- 7:00pmThursday 11:00am- 6:00pm"]), ["Wednesday 2:00pm- 7:00pm", "Thursday 11:00am- 6:00pm"]);
  // A date before a day name is not a time before a day name.
  assert.deepEqual(displayHours(["May 5 Sunday 10am-4pm"]), ["May 5 Sunday 10am-4pm"]);
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
  assert.deepEqual(displayHours(["Happy Hour Wednesday-Friday 12-6 PM"]), []);
  assert.deepEqual(displayHours(["Daily 9am-5pm", "Daily 9am-5pm"]), ["Daily 9am-5pm"]);
  assert.equal(displayHours([""]).length, 0);
});

test("a shop that shouts its hours still states its hours", () => {
  assert.deepEqual(displayHours(["SUNDAY-WEDNESDAY 12-11pm"]), ["SUNDAY-WEDNESDAY 12-11pm"]);
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
