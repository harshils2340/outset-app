import { test } from "node:test";
import assert from "node:assert/strict";
import { MARKETPLACES, NOT_OPERATOR_HOST } from "../contacts.ts";

const refused = (host: string) => MARKETPLACES.test(host) || NOT_OPERATOR_HOST.test(host);

/**
 * Twenty-seven rows shipped in catalog.json as bookable listings whose domain is nobody's local business.
 * Each host below is one of them, named with the listing a guest was offered.
 */
test("a retailer, an app store, a search engine or a directory is never an operator", () => {
  for (const host of [
    "amazon.com", // "Amazon.com", a hot air balloon ride in Fort Myers, FL
    "apps.apple.com", // "Coast Life", a fishing charter in Palm Coast, FL
    "apple.com", // "Steve Jobs Theater", Cupertino, CA
    "youtube.com", // "Red white and blue guide services", San Antonio, TX
    "en.wikipedia.org", // "Blanche Ely House Museum", Pompano Beach, FL
    "post.craigslist.org", // "Boat Rental - Newport", Newport, OR
    "foursquare.com", // "Dezell House Museum", Greensboro, FL
    "indeed.com", // "Indeed", Vero Beach, FL
    "bbb.org", // "Smash Room of Tampa", Tampa, FL
    "almanac.com", // "Almanac.com", a cruise in Homestead, FL
    "affordabletours.com", // "AffordableTours.Com", 9,250 tours worldwide, filed under Sugar Land, TX
    "search.sunbiz.org", // "Sunbiz.org", the Florida corporate registry, Naples, FL
    "zoominfo.com",
    "apartments.com",
    "roomies.com",
    "google.com",
    "sites.google.com",
  ]) {
    assert.equal(refused(host), true, host + " should be refused");
  }
});

test("a booking vendor's own hosted pages are the vendor, not the shop", () => {
  for (const host of [
    "app.squareup.com", // "A to Z Rentals LLC", Decatur, AL
    "book.squareup.com", // "Sea Water Sports Jet Ski Rentals Long Beac", Long Beach, CA
    "squareup.com", // "Duffy Boats Rentals", Marina Del Rey, CA
    "panamacityparasail.rezdy.com", // "Panama City Parasail/Jimbo's Salt Life) Parasail PC"
    "rezdy.com",
    "bookeo.com", // "Trapped Guelph", Guelph, ON
    "vagaro.com", // "Mindful Massage", Chico, CA
    "mysite.vagaro.com", // "primary:Elements Massage and Wellness of Tiffin", Tiffin, OH
    "fresha.com", // "Siesta Massage", Naperville, IL
    "mindbodyonline.com", // "The Only Studio", Bay Harbor Islands, FL
    "massagebook.com", // "Berkeley Deep Sports Massage", San Francisco, CA
    "hipcamp.com", // "Camp Indigo", Hartsel, CO
    "booksy.com",
    "xola.com",
    "fareharbor.com",
  ]) {
    assert.equal(refused(host), true, host + " should be refused");
  }
});

/**
 * The reason the site builders are not on the list. A bare `squarespace.com` is Squarespace, but a named
 * subdomain there is one shop's own website, and about 250 operators in the catalog have no other.
 */
test("an operator's own domain is left alone", () => {
  for (const host of [
    "hide-away-cove.squarespace.com", // Hide-Away-Cove Family Campground, Killingly, CT
    "spaceportrvpark.squarespace.com", // Spaceport RV Park, Mojave, CA
    "wolfsridgepaintball.wordpress.com", // Wolf's Ridge Paintball, Riner, VA
    "wastelandspaintball.weebly.com", // Wastelands Paintball, Trenton, ON
    "hotstonespastayton.business.site", // Hot Stone Spa, Stayton, OR
    "knotscharters.godaddysites.com", // Knots Charters, St Louis, MO
    "christinermt.janeapp.com", // Christine Peterson, RMT, Vancouver, BC
    "richmond.ca", // City of Richmond, BC: Steveston Outdoor Pool
    "boulevard.com", // Boulevard Brewing Company, Kansas City, MO
    "airboattour.com", // AirboatTour.Com, Tamarac, FL
    "goskydiving.com", // GoSkydiving.com, Miami, FL
    "skydivetampabay.com",
    "captainchip.com",
    "meetachef.com",
    "hawaiitours.com",
  ]) {
    assert.equal(refused(host), false, host + " should be kept");
  }
});
