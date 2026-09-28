import assert from "node:assert/strict";
import test from "node:test";

import { addressOf, postalOf, streetOf, townOf } from "../address";

/**
 * The line under "Where you'll be", which is also what the Maps link searches for. Every contact below is a
 * real one from public/o, named by the listing it came from.
 */

test("a street that only repeats the town is not printed twice", () => {
  assert.equal(streetOf({ street: "Sarasota", city: "Sarasota", region: "FL" }), ""); // o-2di4glass-com
  assert.equal(addressOf({ street: "Miami", city: "Miami", region: "FL" }), "Miami, FL"); // o-490lab-com
  assert.equal(streetOf({ street: "Key Largo", city: "Key Largo", region: "FL" }), ""); // o-abeyondblessedcharters-com
});

test("a town and a state in the street slot is a place, not an address inside one", () => {
  // The page read "Agawam, MA, Boston, MA", two towns on one line, and the map link went looking for both.
  assert.equal(addressOf({ street: "Agawam, MA", city: "Boston", region: "MA" }), "Boston, MA"); // o-agawambowl-com
  assert.equal(streetOf({ street: "Ocean Springs, MS", city: "Biloxi", region: "MS" }), ""); // o-coastalmississippi-com
  // A road with a number on it keeps its line even when a state code follows.
  assert.equal(streetOf({ street: "1143 Nila Road", city: "West  Guilford", region: "ON" }), "1143 Nila Road"); // o-sleepyhollowcamping-com
});

test("a house number with no road on it places nobody", () => {
  assert.equal(addressOf({ street: "3615", city: "Wharton", region: "TX" }), "Wharton, TX"); // o-20thcenturytech-com
  // A state on its own is not an address either, so this listing prints no address line at all.
  assert.equal(addressOf({ street: "420", region: "OH" }), null); // o-americaspackardmuseum-org
  assert.equal(streetOf({ street: "#690", city: "Bracebridge", region: "ON" }), ""); // o-cottageair-com
});

test("the shop's phone glued in front of the road name comes off", () => {
  assert.equal(streetOf({ street: "866-252-6840 Scenic Drive", city: "Shelby", region: "MI" }), "Scenic Drive"); // o-benonashores-com
  assert.equal(streetOf({ street: "920-336-6204 County Road PP", city: "De Pere", region: "WI" }), "County Road PP"); // o-hillyhaven-com
  // A house number that happens to run to ten digits is not a phone number.
  assert.equal(streetOf({ street: "144192 2253 Drive E", city: "De Winton", region: "AB" }), "144192 2253 Drive E"); // o-naturesfamilycampground-com
});

test("spacing a crawl left behind is tidied, not dropped", () => {
  assert.equal(streetOf({ street: "102 Martin Luther King  Avenue" }), "102 Martin Luther King Avenue"); // o-lincolnvillemuseum-org
  assert.equal(streetOf({ street: "10930 Endeavour Way", city: "Seminole " }), "10930 Endeavour Way"); // o-rappbrewing-com
  assert.equal(streetOf({ street: "301 Montée Outaouais, , C.P. 190," }), "301 Montée Outaouais, C.P. 190"); // o-golfrockland-ca
  assert.equal(streetOf({ street: "13722 Champions Drive," }), "13722 Champions Drive"); // o-championsgolfclub-com
});

test("a postcode is one postcode, or none", () => {
  assert.equal(postalOf("T0J 2V0;T0J 0Y9"), "T0J 2V0"); // o-11bridgescampground-ca
  assert.equal(postalOf("06510-2302;06510"), "06510-2302"); // o-britishart-yale-edu
  assert.equal(postalOf("249 Deerhurst Highlands Dr, Huntsville, P1H 2E8"), "P1H 2E8"); // o-deerhurstresort-com
  assert.equal(postalOf("AB T3J 0L1"), "T3J 0L1"); // o-wingfieldgolf-ca
  assert.equal(postalOf("xico"), ""); // o-bajaridesandtours-com, the tail of "Mexico"
  assert.equal(postalOf("Canada N0G"), ""); // o-fairbanksequestrian-net, half a code
  assert.equal(postalOf("840003"), ""); // o-blackbeltutah-com
  assert.equal(postalOf(null), "");
  assert.equal(addressOf({ city: "Vernon", region: "BC", postal: "lifornia" }), "Vernon, BC");
});

test("the addresses the other 45,786 listings publish are unchanged", () => {
  assert.equal(
    addressOf({ street: "15860 Round Island", city: "Clayton", region: "NY", postal: "13624" }),
    "15860 Round Island, Clayton, NY, 13624",
  ); // o-1000islandexcursions-com
  assert.equal(addressOf({ street: "801 South Ankeny Boulevard", city: "Ankeny", region: "IA", postal: "50021" }), "801 South Ankeny Boulevard, Ankeny, IA, 50021"); // o-1eda-com
  assert.equal(streetOf({ street: "Pier 26 at the southern end of Hudson River Park", city: "New York" }), "Pier 26 at the southern end of Hudson River Park"); // o-downtownboathouse-org
  assert.equal(addressOf({}), null);
});

/**
 * 1,200 shipped listings publish a state or province and nothing else, and 9 a state and a postcode. The Where
 * card called that an address, and Otto answered "where are you" with "They're at OH.".
 */
test("a state on its own, with or without a postcode, is not an address", () => {
  assert.equal(addressOf({ region: "OH" }), null); // o-1515lg-com ships this shape
  assert.equal(addressOf({ street: null, city: null, region: "NC", postal: "28801" }), null); // o-alchemyasheville-com
  // A town is a place a guest can go to, so it still prints, with or without a street.
  assert.equal(addressOf({ city: "Asheville", region: "NC", postal: "28801" }), "Asheville, NC, 28801");
  assert.equal(addressOf({ street: "12 Pier Rd", region: "NC" }), "12 Pier Rd, NC");
  assert.equal(addressOf({}), null);
});

/**
 * The town field gets the same tidy the street field has always had. Three shipped contacts carry the crawl's
 * punctuation in their city, and each of them is wrong on five surfaces at once: the Where card, the Maps
 * query, the booking confirmation's "Getting there" row, the static `/l/` page and Otto's answer to "where
 * are you".
 */
test("a town keeps the crawl's stray comma and double space out of the address line", () => {
  assert.equal(
    addressOf({ street: "1702 Cedar Valley Rd", city: "Cavan-Monaghan,", region: "ON", postal: "K9J 6Y3" }),
    "1702 Cedar Valley Rd, Cavan-Monaghan, ON, K9J 6Y3",
  ); // o-baxtercreekgolf-com
  assert.equal(
    addressOf({ street: "10930 Endeavour Way", city: "Seminole ", region: "FL", postal: "33777" }),
    "10930 Endeavour Way, Seminole, FL, 33777",
  ); // o-rappbrewing-com
  assert.equal(
    addressOf({ street: "1143 Nila Road", city: "West  Guilford", region: "ON", postal: "K0M 2S0" }),
    "1143 Nila Road, West Guilford, ON, K0M 2S0",
  ); // o-sleepyhollowcamping-com
  assert.equal(townOf({ city: "Cavan-Monaghan,", region: "ON" }), "Cavan-Monaghan, ON");
  assert.equal(townOf({ city: "Clayton", region: "NY" }), "Clayton, NY");
  assert.equal(townOf({ city: null, region: "NY" }), "NY");
  assert.equal(townOf({}), "");
});
