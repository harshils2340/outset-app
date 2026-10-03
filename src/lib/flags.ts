/**
 * Switches for whole surfaces of the guest app, in one file so turning one back on is one line.
 */

/**
 * Every guest-facing agent surface, behind one switch.
 *
 * That is: Ask Outset (the concierge in `components/web/WebConcierge.tsx`) and every way into it, meaning the
 * Browse / Agent toggle in the desktop header, the spark button beside the phone search pill, `#ask` links and
 * the listing pages' Ask buttons; the desktop listing's "Questions before you book?" block; the phone listing's
 * Ask Outset panel and its "Ask Outset instead" call picker; the operator chat threads (`openChat`, the Inbox
 * list, the chat screen); the confirmation page's line pointing at Otto; and Otto paying from a saved card
 * (`OTTO_LIVE` in `lib/wallet.ts`: the Profile card, "Book with Otto", the `#safe` explainer).
 *
 * Off since 3 October 2026, the founder's call: a guest gets the listing, the booking box and the shop's own
 * phone, hours and address, and nothing on the page talks back. Off means none of it renders, and a `#ask` link
 * lands on the page it would have opened over. The code behind it stays where it is (`lib/concierge.ts`,
 * `lib/companyAgent.ts`, `lib/ottoModel.ts`, the API's concierge and `/otto/ask` routes), so bringing it back
 * is this one line. Ask Outset and Otto paying keep their own development-build-only gates on top of this one
 * (`AGENT_MODE_LIVE` in `lib/concierge.ts`, `OTTO_LIVE` in `lib/wallet.ts`), exactly as before the switch.
 *
 * The operator side is not guest-facing and does not read this: the dashboard's Assistant page, its test chat
 * and the claim funnel ("Work here? Manage this listing") stay as they are.
 *
 * Typed `boolean` rather than left as the literal `false`, so TypeScript goes on checking the code it guards
 * instead of narrowing every branch behind it to `never`.
 */
export const GUEST_AGENT: boolean = false;
