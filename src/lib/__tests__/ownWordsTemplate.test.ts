import assert from "node:assert/strict";
import test from "node:test";
import { notTheirWords, ownWords } from "../ownWords";

/**
 * Six shipped listings publish a site builder's own placeholder copy as their own words.
 *
 * `ownWords.ts` already refuses the Latin filler a WordPress theme ships. This is the English half of the
 * same thing, which it could not see: a Squarespace text block's "This is a paragraph", a Wix one's "Edit
 * this text and tell your site visitors who you are", a video block's "Double-click the video to edit it".
 * The shop never wrote a word of it. It comes three ways round and each wants a different answer, so the
 * builder's sentences are taken out and what is left decides: nothing left is a gap, and real copy left is
 * the shop's.
 */

const WHOLE_FIELD = [
  ["Green Valley Ranch Golf Course, blurb", "This is a paragraph. Writing in paragraphs lets visitors find what they are looking for quickly and easily."],
  [
    "Rent My Boat Oahu, blurb",
    "Edit this text and tell your site visitors who you are. To edit, simply click directly on the text and add your own words. Use this text to go into more detail about your company.",
  ],
  [
    "Bones Fishing, Cove Fishing",
    "Double-click the video to edit it and enter a short description of the video here. Double-click the video to edit it and enter a short description of the video here. Double-click the video to edit it and enter a short description of the video here.",
  ],
  [
    "Norton Sports & Learning, Rental Application",
    "information would go here. Use the text editor to style the content as needed. You can include links with the text to direct people elsewhere on the site. FAQ style that uses a title that is really, really, really, really long and might wrap to two",
  ],
] as const;

test("a field that is nothing but the builder's placeholder copy reads as no description", () => {
  for (const [who, text] of WHOLE_FIELD) {
    assert.equal(notTheirWords(text), true, who + " should read as no description");
    assert.equal(ownWords(text), "", who + " should publish a gap rather than the theme's label");
  }
});

test("placeholder copy in front of the shop's own facts is a heading, and the facts stay", () => {
  const md =
    "Your Content Goes Here Calling Lake Municipal Campground Open seasonally May-September Number of sites: 81 Cost: $36/night";
  assert.equal(notTheirWords(md), false);
  assert.equal(ownWords(md), "Calling Lake Municipal Campground Open seasonally May-September Number of sites: 81 Cost: $36/night");
});

test("placeholder copy after the shop's own facts is cut, and the sentences around it close up", () => {
  const littlefield =
    "Littlefield can host your next private event. Your content goes here. Edit or remove this text inline or in the module Content settings. We are a hip and eco-friendly performance space.";
  assert.equal(notTheirWords(littlefield), false);
  assert.equal(ownWords(littlefield), "Littlefield can host your next private event. We are a hip and eco-friendly performance space.");
});

/**
 * Narrow on purpose. Every pattern is a whole sentence one of these themes ships, so an ordinary sentence
 * that happens to use one of the same words is untouched, and a field that loses no sentence is not tidied
 * either: collapsing space and trimming a leading bullet unconditionally turned "- All non-edit photos." on
 * a Viator product into no text at all.
 */
test("the shop's own words are left exactly as they are", () => {
  for (const real of [
    "- All non-edit photos.",
    "Edit your booking up to 24 hours before departure.",
    "This is a paragraph of our story: the boat was built in 1974.",
    "Each paragraph of the waiver has to be initialled.",
    "The photo editor is on the second floor and the text editor beside it.",
    "We will tell your site visitors nothing; this is a private charter.",
  ]) {
    assert.equal(notTheirWords(real), false, real + " is the shop's own sentence");
    assert.equal(ownWords(real), real, real + " should be printed as written");
  }
});

/** A lost byte inside a field that also carried filler is still repaired, and in the right order. */
test("a lost apostrophe is still put right once the filler is out", () => {
  const got = ownWords("Your Content Goes Here Today�s trip leaves at nine from the north dock.");
  assert.equal(got, "Today's trip leaves at nine from the north dock.");
});

/** And that the screen is read where records arrive, not only exported. */
test("a record arriving from a detail file loses the theme's label and keeps the shop's facts", async () => {
  const { experienceById, mergeCatalog } = await import("../catalog");
  const item = {
    id: "o-ownwordstemplate-test-example",
    title: "Green Valley Ranch Golf Course",
    cat: "play",
    art: "golf",
    area: "Denver, CO",
    src: "ownwordstemplate-test.example",
    options: [],
    blurb: WHOLE_FIELD[0][1],
    services: [
      { name: "Cove Fishing", desc: WHOLE_FIELD[2][1], variants: [] },
      { name: "Twilight nine", desc: "Your Content Goes Here Nine holes after four, cart included.", variants: [] },
    ],
  } as unknown as import("../../data/types").Unclaimed;
  mergeCatalog([item], {});
  const got = experienceById("o-ownwordstemplate-test-example")!;
  assert.equal(got.blurb, "");
  assert.equal(got.services![0].desc, null);
  assert.equal(got.services![1].desc, "Nine holes after four, cart included.");
});
