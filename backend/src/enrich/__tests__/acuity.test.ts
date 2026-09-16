import { test } from "node:test";
import assert from "node:assert/strict";
import { acuityRef, parseBusiness, readAcuity } from "../vendors/acuity.ts";
import { loadExchanges, withReplay } from "./fixtures/replay.ts";

// fixtures/acuity: Zuma's Rescue Ranch (zumasbookingpage.as.me/schedule/fc33f127), 15 September 2026.
// Two exchanges: robots.txt and the schedule page whose <head> carries `var BUSINESS = {...};`.

test("acuityRef canonicalises every Acuity link shape and ignores the embed script", () => {
  assert.deepEqual(acuityRef("https://zumasbookingpage.as.me/schedule/fc33f127/category/Equine%2520Education%2520/appointment/80530255"), { url: "https://zumasbookingpage.as.me/schedule/fc33f127", owner: null, key: "fc33f127" });
  assert.deepEqual(acuityRef("https://app.acuityscheduling.com/schedule.php?owner=12345678&appointmentType=1"), { url: "https://app.acuityscheduling.com/schedule.php?owner=12345678", owner: "12345678", key: null });
  assert.deepEqual(acuityRef("https://app.squarespacescheduling.com/schedule/ab12cd34"), { url: "https://app.squarespacescheduling.com/schedule/ab12cd34", owner: null, key: "ab12cd34" });
  assert.deepEqual(acuityRef("https://ranch.as.me/?appointmentType=5"), { url: "https://ranch.as.me/", owner: null, key: null });
  assert.deepEqual(acuityRef("https://ranch.as.me/schedule.php"), { url: "https://ranch.as.me/", owner: null, key: null });
  assert.equal(acuityRef("https://embed.acuityscheduling.com/js/embed.js"), null);
  assert.equal(acuityRef("https://www.acuityscheduling.com/"), null);
  assert.deepEqual(acuityRef('<p>Book</p><iframe src="https://app.acuityscheduling.com/schedule.php?owner=12345678&amp;ref=embedded_csp" title="Schedule"></iframe>'), { url: "https://app.acuityscheduling.com/schedule.php?owner=12345678", owner: "12345678", key: null });
  assert.equal(acuityRef('<script src="https://embed.acuityscheduling.com/js/embed.js"></script>'), null);
});

test("parseBusiness finds the BUSINESS literal in the recorded page", () => {
  const page = loadExchanges("acuity").find((e) => /\/schedule\/fc33f127$/.test(e.key))!;
  const b = parseBusiness(page.body);
  assert.ok(b);
  assert.equal(typeof b.id, "number");
  assert.equal(b.currencyAbbreviation, "USD");
  assert.equal(parseBusiness("<html><head></head></html>"), null);
});

test("Acuity: Zuma's Rescue Ranch reads 22 appointment types and 6 packages with category, duration and price", async () => {
  const ref = acuityRef("https://zumasbookingpage.as.me/schedule/fc33f127/category/Equine%2520Education%2520/appointment/80530255")!;
  const { result: r } = await withReplay("acuity", () => readAcuity(ref));
  assert.ok(r, "reader returned null");
  assert.equal(r.vendor, "acuity");
  assert.equal(r.pages, 1);
  assert.equal(r.offerings.length, 28);

  const row = (name: string) => {
    const o = r.offerings.find((x) => x.name === name);
    assert.ok(o, `missing ${name}`);
    return o;
  };
  const colt = row("Colt Starting");
  assert.equal(colt.detail, "Equine Education · 1 hour");
  assert.equal(colt.duration, "1 hour");
  assert.equal(colt.price, 60);
  assert.equal(colt.unit, "each");
  assert.equal(colt.url, "https://zumasbookingpage.as.me/?appointmentType=78525101");
  assert.equal(colt.photos[0], "https://cdn-s.acuityscheduling.com/calendar-14056826.jpeg?1780331432");
  assert.equal(row("Equine Wellness Check Class").price, 25);
  assert.equal(row("Equine Wellness Check Class").duration, "30 min");
  assert.equal(row("New Rider Evaluation").detail, "Riding Program · 45 min");
  assert.equal(row("Private Walk/Trot/Canter/Jump Lesson").price, 90);
  assert.equal(row("Therapy with Misty Perry").price, 120);
  // Classes carry their size; series and classes are always per seat.
  const ranchDays = row("School’s Out Ranch Days");
  assert.equal(ranchDays.detail, "Group class · up to 6 · 4 hours");
  assert.equal(ranchDays.price, 50);
  assert.equal(row("Meet Me at the Barn: Preteen Group").detail, "Group class · up to 5 · 1.5 hours");
  // Packages from the catalog: priced bundles, no duration; gift certificates are skipped.
  const pkg = row("Beginner Walk Only Package");
  assert.equal(pkg.detail, "Package");
  assert.equal(pkg.duration, null);
  assert.equal(pkg.price, 320);
  assert.equal(pkg.url, "https://zumasbookingpage.as.me/catalog.php");
  assert.equal(r.offerings.filter((o) => o.detail === "Package").length, 6);
  assert.ok(!r.offerings.some((o) => /gift/i.test(o.name)));

  assert.equal(r.company.currency, "USD");
  assert.equal(r.company.cover, "https://cdn-s.acuityscheduling.com/appointmentType-80530255.jpeg?1751742260");
  assert.equal(r.company.cancellation, "All changes requires a 48 hour notice to change appointments.");
  assert.ok(r.policies.includes("All changes requires a 48 hour notice to change appointments."));
  assert.ok(r.requirements.includes("Open to children ages 5–12 who are currently enrolled in Kindergarten or above."), JSON.stringify(r.requirements));
  assert.ok(r.includes.includes("Includes eight age-appropriate Tiny Tot lessons introducing young riders to horses in a safe and fun environment."), JSON.stringify(r.includes));
});
