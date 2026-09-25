import { strict as assert } from "node:assert";
import test from "node:test";
import { decode, encode, ipv4ToInt, ipv6Top64, lookup, mergeAdjacent, type Table } from "../ipMetro.ts";

test("IPv4 text becomes an unsigned 32-bit number, and junk becomes null", () => {
  assert.equal(ipv4ToInt("0.0.0.0"), 0);
  assert.equal(ipv4ToInt("1.2.3.4"), 16909060);
  assert.equal(ipv4ToInt("255.255.255.255"), 4294967295);
  assert.equal(ipv4ToInt("256.1.1.1"), null);
  assert.equal(ipv4ToInt("local"), null);
  assert.equal(ipv4ToInt("2001:db8::1"), null);
});

test("IPv6 is keyed on its top 64 bits, with :: and a v4 tail handled", () => {
  assert.equal(ipv6Top64("2001:db8:1:2:3:4:5:6"), 0x2001_0db8_0001_0002n);
  assert.equal(ipv6Top64("2001:db8::1"), 0x2001_0db8_0000_0000n);
  assert.equal(ipv6Top64("::1"), 0n);
  assert.equal(ipv6Top64("[2607:f8b0:4020:801::200e]"), 0x2607_f8b0_4020_0801n);
  assert.equal(ipv6Top64("::ffff:1.2.3.4"), 0n);
  assert.equal(ipv6Top64("1.2.3.4"), null);
  assert.equal(ipv6Top64("2001:db8:::1"), null);
});

test("adjacent ranges that agree merge; a gap or a different metro keeps them apart", () => {
  const merged = mergeAdjacent([
    { start: 0, end: 9, metro: 1 },
    { start: 10, end: 19, metro: 1 },
    { start: 20, end: 29, metro: 2 },
    { start: 40, end: 49, metro: 2 },
  ]);
  assert.deepEqual(merged, [
    { start: 0, end: 19, metro: 1 },
    { start: 20, end: 29, metro: 2 },
    { start: 40, end: 49, metro: 2 },
  ]);
  const merged6 = mergeAdjacent([{ start: 0n, end: 9n, metro: 0 }, { start: 10n, end: 19n, metro: 0 }]);
  assert.deepEqual(merged6, [{ start: 0n, end: 19n, metro: 0 }]);
});

test("a table survives encoding and answers lookups on both address families", () => {
  const t: Table = {
    metros: ["tampa", "toronto"],
    v4: [{ start: ipv4ToInt("10.0.0.0")!, end: ipv4ToInt("10.0.255.255")!, metro: 0 }, { start: ipv4ToInt("192.168.0.0")!, end: ipv4ToInt("192.168.255.255")!, metro: 1 }],
    v6: [{ start: 0x2607_f8b0_0000_0000n, end: 0x2607_f8b0_ffff_ffffn, metro: 1 }],
  };
  const back = decode(encode(t));
  assert.deepEqual(back, t);
  assert.equal(lookup(back, "10.0.7.7"), "tampa");
  assert.equal(lookup(back, "192.168.1.1"), "toronto");
  assert.equal(lookup(back, "11.0.0.1"), null);
  assert.equal(lookup(back, "2607:f8b0:4020:801::200e"), "toronto");
  assert.equal(lookup(back, "2a00::1"), null);
  // A v4-mapped v6 address is the v4 address.
  assert.equal(lookup(back, "::ffff:10.0.0.1"), "tampa");
  assert.equal(lookup(back, "local"), null);
});
