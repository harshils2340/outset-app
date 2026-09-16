# Operator outreach: the list and the email

Written for Harshil, to review before anything is sent. Nothing here sends mail.

## 1. The list

File: `backend/data/outreach-list.csv` (ignored by git, never commit it). Rebuild it any time with the SQL in
`docs/outreach-email.md`'s history or ask for a refresh. One row per business: name, domain, website, email, phone,
city, region, country, category, booking software, priced lines, widget lines, photos, cover, reviews, rating, the
listing link, and a readiness score.

Who is in it: every operator in the catalog with a website, an email address, in the US or Canada, not unsubscribed,
not a demo or test row.

| Group | Rows | Send order |
|---|---|---|
| Everyone with an email | 14,297 | |
| Tier 1: cover photo and a priced menu | 4,991 | first |
| of which the menu came from their booking software (exact prices) | 1,240 | the very first |

Sort by the `score` column, highest first. The top of the list is a business whose page already looks finished:
photos, prices, hours, policies. Those are the emails that convert, because the page proves the claim in the email.

Skip rows whose email is a generic box (info@, contact@) at a domain that is not theirs; the sender already does this
(`plausibleEmail` in `backend/src/outreach/drafts.ts`).

## 2. The email

Subject: `A page for {Business name}` (the existing subject; short, specific, not salesy)

Plain text and HTML, same words. Merge fields in braces.

---

Hi,

I'm Harshil. I run Outset, a site where people book local activities the way they book a table on OpenTable: pick a
time, pay, done. No calling around.

I built a page for {Business name} from your website. It has your {N} services with prices, your photos, your hours
and your cancellation policy. I didn't make anything up. Have a look:

{listing link}

There are about 59,000 activity businesses on Outset across the US and Canada, from Florida to British Columbia, and
guests find them by city and activity.

What it costs: nothing to be listed. When a booking comes through Outset, we keep 5% of it. No booking, no fee.
If you already use {FareHarbor}, keep it. This sits alongside it.

If this is your business, this link opens your page so you can fix anything and switch bookings on. It's meant for
the owner, so please don't forward it:

{claim link}

If I've got the wrong business, this takes the page down:

{remove link}

Harshil
Outset, {postal address}

If you'd rather not hear from me: {unsubscribe link}

---

Why it is written this way:

- First line says who and what in one sentence, with a comparison people already understand.
- The second paragraph is the work already done for them, with a number they can check by clicking.
- The scale line is the credibility. 59,000 is the count of published listings on onoutset.com today; update the
  number when you send, never round up.
- Price in one sentence, the objection ("I already use FareHarbor") answered in the next.
- One ask (open your page), one escape hatch (take it down), one unsubscribe. Nothing else.
- No exclamation marks, no "excited", no "revolutionize", no bullet lists, no images. It reads like a person wrote it.

Do not add a traffic number unless it is a real measured figure. "Lots of traffic" with nothing behind it reads as spam.

## 3. Sending without landing in spam

What is already in place:

- From: `Harshil <hello@onoutset.com>` on a verified domain. Resend DKIM signs every message.
- Every email carries a real unsubscribe link in the body; unsubscribed addresses are skipped forever.
- No List-Unsubscribe headers and no tracking pixels: both are bulk-mail signals that push Gmail to Promotions.
- The body is written fresh at send time from the live listing, so a stale price never goes out.

What is still missing before the first send:

1. `MAIL_POSTAL`: a real mailing address (a PO box is fine). The sender refuses to run without it, and CAN-SPAM and
   CASL both require it. Set it on the Render API service and in `backend/.env`.
2. DMARC is `p=none`. Fine for now; move to `p=quarantine` after two clean weeks so spoofed mail gets filtered.
3. Warm up. A new domain sending 5,000 messages on day one gets throttled or blocked. Send 50 on day one, 100 on
   day two, 200, 400, then hold at 500 a day. The sender's `--limit` flag does this.
4. Spread sends across the day, not one burst, and send on weekday mornings in the recipient's time zone.
5. Watch bounces and complaints in the Resend dashboard daily. Over 2% bounces or 0.1% complaints: stop, fix the
   list, resume. Bounced addresses come off the list automatically.
6. Reply from the same address. Replies and "not spam" clicks are the strongest signal a domain gets.
7. Keep the copy plain: no images, one or two links to your own domain, no link shorteners, no ALL CAPS, no "$$$".

Command, once `MAIL_POSTAL` is set (sends the top of the list, up to the limit):

```
cd backend && npx tsx src/index.ts outreach-send --limit=50
```

A test to yourself first: `npx tsx src/index.ts outreach-send --to=harshils2340@gmail.com`.
