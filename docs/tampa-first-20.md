# Tampa send list, first batch (20)

Open each listing before sending. Send order is by Google review count.

| # | Business | Reviews | Priced options | Photos | Email | Listing |
|---|---|---|---|---|---|---|
| 1 | Hubbard's Marina | 13,019 | 7 | 19 | info@hubbardsmarina.com | https://onoutset.com/#o=o-hubbardsmarina-com |
| 2 | PARASAIL SIESTA | 10,343 | 3 | 18 | parasailsiesta@yahoo.com | https://onoutset.com/#o=o-parasailsiesta-com |
| 3 | Siesta Key Watersports | 9,258 | 6 | 19 | skwatersports@gmail.com | https://onoutset.com/#o=o-siestakeywatersports-com |
| 4 | Paddles Outdoor Rentals | 3,704 | 5 | 18 | clearkayakingtours@gmail.com | https://onoutset.com/#o=o-paddlesoutdoorrentals-com |
| 5 | Fly Heli St. Petersburg | 2,810 | 5 | 9 | info@flyhelitours.com | https://onoutset.com/#o=o-flyhelitours-com |
| 6 | Dolphin Quest Eco Tours | 2,759 | 7 | 19 | info@hubbardsmarina.com | https://onoutset.com/#o=o-boattoursjohnspass-com |
| 7 | Suncoast Watersports | 2,078 | 21 | 19 | gclick0003@yahoo.com | https://onoutset.com/#o=o-funstpete-com |
| 8 | Starlite Horizon Dining Yacht | 1,735 | 20 | 17 | info@starlitecruises.com | https://onoutset.com/#o=o-starlitecruises-com |
| 9 | Fun Boat Tours | 1,619 | 6 | 17 | Info@funboattours.com | https://onoutset.com/#o=o-funboattours-com |
| 10 | Crystal River Watersports | 1,592 | 3 | 19 | info@crystalriverwatersports.com | https://onoutset.com/#o=o-crystalriverwatersports-com |
| 11 | Freedom Jet Ski Rentals | 1,579 | 5 | 18 | Info@freedomjetskis.com | https://onoutset.com/#o=o-freedomjetskis-com |
| 12 | Pier Dolphin Cruises | 1,536 | 3 | 9 | seafins@pierdolphincruises.com | https://onoutset.com/#o=o-pierdolphincruises-com |
| 13 | Up River Adventures | 1,417 | 3 | 9 | info@upriveradventures.com | https://onoutset.com/#o=o-upriveradventures-com |
| 14 | Odyssey Cruises | 1,395 | 2 | 19 | adam@odysseycruises.net | https://onoutset.com/#o=o-odysseycruises-net |
| 15 | Mad Beach Party Charter | 1,377 | 4 | 9 | info@madbeachpartycharter.com | https://onoutset.com/#o=o-madbeachpartycharter-com |
| 16 | Totally Tiki Tours | 1,361 | 2 | 9 | info@totallytikitours.com | https://onoutset.com/#o=o-totallytikitours-com |
| 17 | Sarasota Helicopter Tour | 1,271 | 6 | 19 | markmontgo@me.com | https://onoutset.com/#o=o-sarasotahelicoptertour-com |
| 18 | Tampa Bay Fun Boat | 1,236 | 3 | 19 | info@tampabayfunboat.com | https://onoutset.com/#o=o-tampabayfunboat-com |
| 19 | Blind Pass Boat and Jet Ski Rental | 1,104 | 10 | 9 | jvitalo.bpc@gmail.com | https://onoutset.com/#o=o-blindpassboatandjetski-com |
| 20 | NL Boat & Jet Ski Rentals Sarasota | 970 | 4 | 4 | nextleveljetski@gmail.com | https://onoutset.com/#o=o-nextlevel-rentals-com |

## Before you hit send

1. Put your PO box (or a real street address) in `MAIL_POSTAL` on Render, and set `MAIL_FROM` to `Outset <hello@onoutset.com>` (domain is verified in Resend).
2. Send yourself one: `cd backend && npx tsx src/index.ts outreach-send --to=harshils2340@gmail.com`. Click both links on your phone.
3. Then these twenty: `npx tsx src/index.ts outreach-send --limit=20 --metro=tampa`. The sender takes the highest-reviewed unsent Tampa drafts first, which is this list.
4. Replies come to hello@onoutset.com. Call the ones who click within the hour; the owner-contact CSV has direct numbers for several of them.