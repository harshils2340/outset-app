import { test } from "node:test";
import assert from "node:assert/strict";
import { MAILBOX_ERROR, NETWORK_ERROR, pickIdentity } from "../sendOtto.ts";

test("the mailbox with the most allowance left sends next, so the day's load spreads evenly", () => {
  assert.equal(pickIdentity({ "a@gmail.com": 3, "b@gmail.com": 10, "c@gmail.com": 7 }), "b@gmail.com");
  assert.equal(pickIdentity({ "a@gmail.com": 0, "b@gmail.com": 0 }), null, "every mailbox spent: nothing more today");
  assert.equal(pickIdentity({}), null);
});

test("a dead network is told apart from a bad password, so it is retried rather than benched", () => {
  for (const e of ["connect ENETUNREACH 64.233.178.108:587 - Local (0.0.0.0:58716); on 465: connect EHOSTUNREACH", "Greeting never received", "Connection timeout", "getaddrinfo EAI_AGAIN smtp.gmail.com"]) {
    assert.ok(NETWORK_ERROR.test(e) && MAILBOX_ERROR.test(e), e);
  }
  for (const e of ["535-5.7.8 Username and Password not accepted", "Daily user sending limit exceeded", "EAUTH"]) {
    assert.ok(!NETWORK_ERROR.test(e) && MAILBOX_ERROR.test(e), e + " is the mailbox's own problem");
  }
});

test("a mailbox's own failure is told apart from a recipient's", () => {
  for (const e of ["535-5.7.8 Username and Password not accepted", "Invalid login: 535", "Daily user sending limit exceeded", "EAUTH", "no such sending mailbox: x@gmail.com", "read ECONNRESET", "Connection timeout", "connect ETIMEDOUT 74.125.197.109:587; on 465: connect EHOSTUNREACH"]) {
    assert.ok(MAILBOX_ERROR.test(e), e);
  }
  for (const e of ["550 5.1.1 The email account that you tried to reach does not exist", "452 4.2.2 The recipient's inbox is out of storage space", "bad address"]) {
    assert.ok(!MAILBOX_ERROR.test(e), e + " is the recipient's problem, not the mailbox's");
  }
});
