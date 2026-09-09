import type { OperatorContact, Unclaimed } from "../data/types";
import { addressLine, fmtHours, fmtPhone, optionLabel, plainWords } from "./catalog";
import { money } from "./format";

/**
 * 24/7 company assistant for a catalog operator.
 *
 * Harness rules, in order:
 * 1. It answers only from this operator's published facts (options, specs, includes, notes, contact).
 * 2. It never uses outside knowledge: no weather, no directions, no comparisons, no other businesses, no guesses.
 * 3. If a fact is not published, it says so and hands off to a person at the shop.
 * 4. It never confirms availability, holds, or discounts. Booking happens through the app flow.
 */

export type CompanyContext = { item: Unclaimed; contact: OperatorContact | null };

const HANDOFF = " A person at the shop can help with that.";

function callLine(ctx: CompanyContext): string {
  return ctx.contact?.phone ? " Tap Call the shop, " + fmtPhone(ctx.contact.phone) + "." : " Tap Call the shop.";
}

function notPublished(ctx: CompanyContext, what: string): string {
  return ctx.item.title + " has not published " + what + ", so I will not guess." + HANDOFF + callLine(ctx);
}

/** Things this agent must never try to answer, whatever the phrasing. */
const OUT_OF_SCOPE =
  /(weather|forecast|rain|wind|storm|hurricane|traffic|directions|how (do|to) (i )?get there|uber|lyft|parking|hotel|restaurant|food|competitor|compare|cheaper|better than|other (company|place|shop|operator)|near(by|est)|review|yelp|google|reddit|news|history|who owns|owner|lawsuit|accident|safety record|injur|death|died)/i;

const PRICE = /(how much|price|pricing|cost|rate|fee|expensive|cheap|\$|deposit)/i;
const SERVICES = /(what do you (offer|have)|options|services|packages|tours?|rentals?|menu|length|how long|duration|hours? long|minutes)/i;
const HOURS = /(hours|open|close|closing|opening|what time|when are you|sunday|monday|tuesday|wednesday|thursday|friday|saturday|weekend|today|tomorrow)/i;
const WHERE = /(where|address|location|located|meet|meeting point|launch|dock|find you)/i;
const PHONE = /(phone|call|number|reach|contact|email|text you)/i;
const LIMITS = /(age|old|kid|child|children|minor|weight|lbs|pound|height|tall|license|licence|permit|experience|beginner|first.?time|pregnan|disab|wheelchair|swim)/i;
const INCLUDED = /(include|come with|provided|bring|wear|gear|equipment|life ?jacket|pfd|helmet|towel|camera|photo|video|guide)/i;
const POLICY = /(cancel|refund|reschedule|change|late|no.?show|policy|rain.?check|tip|gratuity)/i;
const AVAIL = /(available|availability|book|reserve|slot|spot|space|open (at|on)|can i come|walk.?in)/i;
const GROUP = /(group|party|birthday|corporate|team|bachelor|bachelorette|how many|max|capacity|people)/i;
const WAIVER = /(waiver|sign|form|paperwork|release)/i;
const GREET = /^(hi|hello|hey|yo|sup|good (morning|afternoon|evening))\b/i;
const THANKS = /(thank|thanks|thx|cheers|great|perfect|awesome)/i;

function priced(item: Unclaimed): string[] {
  if (item.services?.length) {
    return item.services
      .filter((s) => s.variants.some((v) => v.price != null))
      .map((s) => plainWords(s.name) + ": " + s.variants.filter((v) => v.price != null).map((v) => plainWords(v.label) + " " + money(v.price as number) + (v.per || "")).join(", "));
  }
  return item.options
    .filter((o) => o.price != null)
    .map((o) => plainWords(optionLabel(o)) + " " + money(o.price as number) + (o.per || ""));
}

function menu(item: Unclaimed): string {
  if (item.services?.length) {
    return item.services
      .map((s) => {
        const vs = s.variants.map((v) => plainWords(v.label) + (v.price != null ? " " + money(v.price) : "")).join(", ");
        return plainWords(s.name) + (vs ? " (" + vs + ")" : "");
      })
      .join("; ");
  }
  return item.options.map((o) => plainWords(optionLabel(o))).join("; ");
}

function describe(item: Unclaimed, q: string): string | null {
  if (!item.services?.length) return null;
  const lq = q.toLowerCase();
  const hit = item.services.find((s) => s.desc && lq.includes(s.name.toLowerCase().split(" ")[0]));
  return hit && hit.desc ? plainWords(hit.name) + ": " + plainWords(hit.desc) : null;
}

function specsAbout(item: Unclaimed, re: RegExp): string[] {
  return [...item.specs, ...item.includes, item.extraNote || ""].filter((s) => s && re.test(s));
}

/** The assistant's name, shown on every listing. */
export const ASSISTANT_NAME = "Otto";

export function companyGreeting(ctx: CompanyContext): string {
  return "Hi, I'm " + ASSISTANT_NAME + ". Ask me anything about " + ctx.item.title + ". I only use what they've published, so if it isn't on their site I'll say so.";
}

export function companySuggestions(ctx: CompanyContext): string[] {
  const { item } = ctx;
  const out = ["What do you offer and what does it cost?", "Where do we meet?"];
  if (item.cancellation || item.fc) out.push("What's the cancellation policy?");
  else if (ctx.contact?.hours.length || item.hoursText?.length) out.push("What are your hours?");
  else out.push("What should we bring?");
  out.push(item.requirements?.length ? "Any age or weight limits?" : item.bring?.length ? "What should we bring?" : "Any age or weight limits?");
  return out.slice(0, 4);
}

/** A guest question that matches one of the operator's own FAQ entries gets that entry's answer, word for word. */
function faqMatch(item: Unclaimed, q: string): string | null {
  if (!item.faq?.length) return null;
  const words = (t: string) => new Set(t.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length > 3 && !/^(what|when|where|does|have|with|your|this|that|there|will|from|they|them|about|should|could|would|need)$/.test(w)));
  const qw = words(q);
  if (qw.size < 2) return null;
  let best: { score: number; a: string; q: string } | null = null;
  for (const f of item.faq) {
    const fw = words(f.q);
    let hit = 0;
    for (const w of qw) if (fw.has(w)) hit += 1;
    const score = hit / Math.max(2, Math.min(qw.size, fw.size));
    if (hit >= 2 && score >= 0.5 && (!best || score > best.score)) best = { score, a: f.a, q: f.q };
  }
  return best ? "From " + item.title + "'s FAQ, \"" + best.q + "\": " + best.a : null;
}

export function companyReply(ctx: CompanyContext, question: string): string {
  const { item, contact } = ctx;
  const q = question.trim();

  if (GREET.test(q) && q.length < 24) return "Hi. Ask me about " + item.title + "'s services, prices, hours, or where to meet.";
  if (THANKS.test(q) && q.length < 40) return "Any time. When you are ready, pick a service and a time on the listing to book.";

  // Hard stop before any topic matching. Outside knowledge is never used.
  if (OUT_OF_SCOPE.test(q)) {
    return "I only work from " + item.title + "'s own published information, so I cannot help with that." + HANDOFF + callLine(ctx);
  }

  const parts: string[] = [];

  const faq = faqMatch(item, q);
  if (faq) parts.push(faq);

  if (PRICE.test(q)) parts.push((() => {
    const lines = priced(item);
    if (!lines.length) return notPublished(ctx, "prices");
    const extras = item.addons?.length ? " Add-ons: " + item.addons.map((a) => a.name + (a.price ? " " + money(a.price) : "")).join(", ") + "." : "";
    return "Published prices: " + lines.join("; ") + "." + extras + " Outset adds a service fee at checkout.";
  })());

  if (SERVICES.test(q)) parts.push((() => {
    if (!item.options.length && !item.services?.length) {
      const about = item.specs.length ? " What they list: " + item.specs.join(", ") + "." : "";
      return notPublished(ctx, "a service menu") + about;
    }
    const d = describe(item, q);
    return item.title + " offers: " + menu(item) + "." + (d ? " " + d : "") + " Pick one on the listing to see the total.";
  })());

  if (AVAIL.test(q)) parts.push((() => {
    return "I cannot see or hold slots. Pick a date and time on the listing and you get an instant confirmation.";
  })());

  if (HOURS.test(q)) parts.push((() => {
    if (item.hoursText?.length) return "Hours from " + item.title + ": " + item.hoursText.join(", ") + "." + (item.season ? " Season: " + item.season + "." : "");
    if (contact?.hours.length) return "Hours from " + item.title + ": " + contact.hours.map(fmtHours).join(", ") + ".";
    const hint = specsAbout(item, /hour|open|close|am|pm|daily|sunrise|sunset/i);
    if (hint.length) return "What they publish about timing: " + hint.join(" ") + " Exact hours are not listed." + callLine(ctx);
    return notPublished(ctx, "hours");
  })());

  if (WHERE.test(q)) parts.push((() => {
    const addr = contact ? addressLine(contact) : null;
    const arrive = item.checkin ? " When you arrive: " + item.checkin : "";
    if (item.meetingPoint) return "Meet at " + item.meetingPoint + (addr && addr !== item.meetingPoint ? " (" + addr + ")" : "") + "." + arrive;
    if (addr) return "Meet at " + addr + ". The Open in Maps link on the listing takes you there." + arrive;
    return "They are in " + item.area + ". A street address is not published, so the map link on the listing runs a search instead." + callLine(ctx);
  })());

  if (PHONE.test(q)) parts.push((() => {
    if (contact?.phone) return "You can reach a person at " + fmtPhone(contact.phone) + ". Tap Call the shop on the listing.";
    return notPublished(ctx, "a phone number");
  })());

  if (LIMITS.test(q)) parts.push((() => {
    if (item.requirements?.length) return "Published rules: " + item.requirements.join(" ") + " Anything not listed there, I cannot confirm." + callLine(ctx);
    const hits = specsAbout(item, /age|lb|pound|weight|height|license|licence|experience|beginner|kids?|child|swim/i);
    if (hits.length) return "Published limits: " + hits.join(". ") + ". Anything not listed there, I cannot confirm." + callLine(ctx);
    return notPublished(ctx, "age, weight, or license rules");
  })());

  if (INCLUDED.test(q)) parts.push((() => {
    const bring = item.bring?.length ? " Bring: " + item.bring.join(", ") + "." : "";
    if (item.includes.length) return "Included: " + item.includes.join(", ") + "." + bring;
    if (bring) return "What to bring, from " + item.title + ":" + bring;
    return notPublished(ctx, "what is included");
  })());

  if (POLICY.test(q)) parts.push((() => {
    if (item.cancellation || item.policies?.length) {
      const extra = item.policies?.filter((l) => !item.cancellation || !item.cancellation.includes(l)).slice(0, 4) || [];
      return "Their published policy: " + [item.cancellation, ...extra].filter(Boolean).join(" ");
    }
    const hits = specsAbout(item, /cancel|refund|deposit|reschedule|forfeit|policy|hr|hour/i);
    if (hits.length) return "Their published policy: " + hits.map((h) => h.replace(/^their policy:\s*/i, "")).join(" ");
    return notPublished(ctx, "a cancellation or refund policy");
  })());

  if (GROUP.test(q)) parts.push((() => {
    if (item.groupInfo?.length) return "Published group info: " + item.groupInfo.join(" ");
    const hits = specsAbout(item, /group|party|people|riders?|guests?|passengers?|up to|max|capacity|fly together/i);
    if (hits.length) return "Published group info: " + hits.join(". ") + ".";
    return notPublished(ctx, "group sizes");
  })());

  if (WAIVER.test(q)) parts.push((() => {
    const line = item.policies?.find((x) => /waiver|liabilit/i.test(x)) || item.specs.find((x) => /waiver/i.test(x));
    if (item.waiverUrl) return (line ? line + " " : "") + item.title + " has an online waiver. The Sign the waiver link on the listing opens it, so you can do it before you arrive.";
    return line ? "About the waiver: " + line : notPublished(ctx, "waiver details");
  })());

  if (parts.length) return parts.slice(0, 3).join("\n\n");

  return (
    "I can answer questions about " +
    item.title +
    "'s services, prices, hours, location, limits, and what is included, using only what they have published. Which of those do you want?"
  );
}
