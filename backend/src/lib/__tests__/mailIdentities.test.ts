import { test } from "node:test";
import assert from "node:assert/strict";
import { smtpIdentities } from "../mail.ts";

test("every configured mailbox is a sending identity, in order, each writing as Harshil", () => {
  const ids = smtpIdentities({
    MAIL_SMTP_USER: "one@gmail.com", MAIL_SMTP_PASS: "aaaa", MAIL_SMTP_FROM: "Harshil <one@gmail.com>",
    MAIL_SMTP_USER_2: " two@gmail.com ", MAIL_SMTP_PASS_2: "bbbb",
    MAIL_SMTP_USER_3: "three@gmail.com", // no password: not a sender
    MAIL_SMTP_USER_4: "four@gmail.com", MAIL_SMTP_PASS_4: "dddd",
  });
  assert.deepEqual(ids.map((i) => i.user), ["one@gmail.com", "two@gmail.com", "four@gmail.com"]);
  assert.equal(ids[1].from, "Harshil <two@gmail.com>");
  assert.equal(ids[0].from, "Harshil <one@gmail.com>");
  assert.deepEqual(ids.map((i) => [i.host, i.port]), [["smtp.gmail.com", 587], ["smtp.gmail.com", 587], ["smtp.gmail.com", 587]], "Gmail on 587 unless told otherwise");
});

test("a mailbox on another provider carries its own server and port beside the Gmail ones", () => {
  const ids = smtpIdentities({
    MAIL_SMTP_USER: "one@gmail.com", MAIL_SMTP_PASS: "a",
    MAIL_SMTP_USER_2: "h2shah@uwaterloo.ca", MAIL_SMTP_PASS_2: "b", MAIL_SMTP_HOST_2: "mailservices.uwaterloo.ca", MAIL_SMTP_PORT_2: "465",
  });
  assert.deepEqual(ids.map((i) => [i.user, i.host, i.port]), [["one@gmail.com", "smtp.gmail.com", 587], ["h2shah@uwaterloo.ca", "mailservices.uwaterloo.ca", 465]]);
  assert.equal(ids[1].from, "Harshil <h2shah@uwaterloo.ca>");
});

test("the same mailbox listed twice is one sender, and nothing configured is no sender", () => {
  assert.equal(smtpIdentities({ MAIL_SMTP_USER: "one@gmail.com", MAIL_SMTP_PASS: "a", MAIL_SMTP_USER_2: "one@gmail.com", MAIL_SMTP_PASS_2: "a" }).length, 1);
  assert.deepEqual(smtpIdentities({}), []);
});
