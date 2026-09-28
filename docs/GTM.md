# Otto outreach at 200 a day

Read this before setting up a cold-email platform for the Otto pitch. The daily ramp on the Mac
(`backend/scripts/outreach-daily.sh`) sends through one personal Gmail and is capped near 50 a day, which
is the ceiling for cold mail from one personal mailbox. Two hundred a day is a different shape: several
warmed mailboxes on throwaway domains, rotated by a platform that also watches replies and bounces. The
queue, the copy and the compliance footer stay ours; the platform only does the sending.

## What to buy (Harshil's call, about 80 dollars a month)

| Item | Why | Cost |
| --- | --- | --- |
| 2 or 3 new domains, e.g. `getotto.co`, `tryotto.io` | Cold mail never goes from `onoutset.com`; that domain carries real bookings, claim links and sign-in codes. A burned throwaway is a nuisance, a burned `onoutset.com` breaks the product. | about 10 dollars a year each |
| 5 or 6 mailboxes, 2 per domain, e.g. `harshil@getotto.co` | Each warmed mailbox is good for 40 to 50 cold mails a day. Six of them is 240 a day. Google Workspace at 7 dollars a user is the safest sender reputation. | about 40 dollars a month |
| Instantly (Growth plan) or Smartlead (Basic) | Rotates the mailboxes, warms them up automatically, stops a sequence the moment a lead replies, tracks bounces, and takes our CSV with custom variables. Either works; Instantly's lead import and API are the simpler of the two. | 37 to 39 dollars a month |

Set SPF, DKIM and DMARC on every new domain (the platform's setup checklist walks through it) and let
the mailboxes warm for 14 days before the first campaign. Sending from a cold mailbox on day one is how the
whole domain lands in spam.

## The lead file

```
cd backend
npx tsx scripts/outreach-gtm-export.mts --limit=1000
```

That writes `backend/data/exports/otto-gtm-<date>.csv`: the next 1,000 businesses the Otto ramp would
mail, in its order, with every skip it would make (unsubscribed, junk addresses, domains with no mail),
and marks them `handoff` so the ramp never mails them too. The file carries one row per business with:

- `email`, `first_name` (only when the operator's own site named that owner and the mailbox is theirs),
  `company_name`, `website`, `phone`, `city`, `region`, `booking_software`
- `subject`, `body_html`, `body_text`: the pitch, personalised per business, footer included
- `followup_1_html`, `followup_1_text`, `followup_2_html`, `followup_2_text`: the two follow-ups, rendered
  per business with the same footer
- `otto_url`, `cal_url`, `unsubscribe_url`, `remove_url`, in case a step needs to reference them

Upload it as the campaign's lead list and map every extra column to a custom variable of the same name.

## The campaign

Three steps. Each step's template is one variable, nothing else, so the copy and the legal footer are
exactly what left this repo:

| Step | When | Subject | Body |
| --- | --- | --- | --- |
| 1 | day 0 | `{{subject}}` | `{{body_html}}` |
| 2 | day 3 | same thread | `{{followup_1_html}}` |
| 3 | day 7 | same thread | `{{followup_2_html}}` |

Settings that matter:

- Daily limit per mailbox: 40. Sending window: weekdays, 8:00 to 17:00 in the lead's own time.
- Stop on reply: on. Every reply, positive or not, ends the sequence.
- Open tracking and click tracking: off. Tracking pixels and rewritten links are the strongest "this is
  bulk" signal a filter sees, and they add nothing we use.
- The platform's own unsubscribe link: off, or leave it, but never remove ours. Our footer already carries
  `Unsubscribe` (keyed to the address), `Terms`, `Privacy`, the take-it-down link and the postal address.
  That footer is what makes the mail lawful to send; the sender must not edit it.
- Reply-to: `hello@onoutset.com`, the same address every send from the Mac ramp uses (`MAIL_REPLY_TO` in
  `backend/.env`), so every reply from every mailbox and every channel lands in one inbox.

## What comes back

Export leads from the platform once a day (or the filtered unsubscribed, bounced and replied lists) and
fold them in:

```
npx tsx scripts/outreach-gtm-import.mts --file=~/Downloads/leads.csv
npx tsx scripts/outreach-gtm-import.mts --file=~/Downloads/unsubscribed.csv --all=unsub
```

An unsubscribe or a "not interested" goes on the suppression list every sender reads, so neither the
platform's next campaign nor the ramp nor a claim email reaches that address again. A bounce is suppressed
the same way. A reply marks the business `replied`: no further automated touch from anywhere, the
conversation is Harshil's now, and a real mail from him still goes through.

## What this does not do

No automated texts, no automated calls, no automated social messages. Texts and robocalls to cell numbers
without consent are illegal under TCPA, and automated DMs get the account banned. The phone list and the
Facebook and Instagram handles in the catalog are for a person to use by hand.
