import { getAvailability } from "../enrich/availability.ts";
import { cappedDates, crossRead, runChecks, CHECKS, SLOT_CAP, type Finding } from "./availChecks.ts";
import { loadCases, loadExchanges, loadTruth, saveCase, withCase, type AvailCase } from "./availCases.ts";
import type { Availability } from "../enrich/availability.ts";

/**
 * How accurate the availability reader is, measured against the recorded corpus, with no network and no model.
 *
 * Three different questions, kept apart because they are worth different amounts:
 *
 *  1. Does the reader still say what it said when the case was recorded? Cheap, certain, and only a
 *     regression signal. A case that has always been wrong passes this happily.
 *  2. Does the answer break any of the rules in availChecks.ts? These are real defects, each one something a
 *     guest would see, and they need no authority to judge: a midnight departure is wrong on its face.
 *  3. Does the answer agree with a second reading of the same bytes, written separately? Where the two differ
 *     one of them is wrong. This is the closest thing to accuracy available for free, and it is evidence
 *     rather than proof, because two readings can share a misunderstanding.
 *
 * Accuracy against adjudicated truth, where a model or a person has said what the answer should have been, is
 * reported last and only for the cases that have it.
 */

export type CaseScore = {
  kase: AvailCase;
  answer: Availability;
  findings: Finding[];
  /**
   * Reader's starts versus the independent second read, both restricted to the days the reader did not fill
   * to SLOT_CAP. A full day was truncated on purpose and what is missing from it says nothing about accuracy.
   */
  readerStarts: Set<string>;
  crossStarts: Set<string>;
  /** Days left out of the comparison because the reader returned a full one. */
  capped: Set<string>;
  /** Did replaying the recording reproduce the answer recorded at capture time? */
  stable: boolean;
};

const startsOf = (a: Availability): Set<string> =>
  new Set(a.days.flatMap((d) => d.slots.filter((s) => !s.timeUnknown).map((s) => s.startsAt)));

/** Everything but `updatedAt`, which is a wall clock reading and differs on every replay by design. */
const comparable = (a: Availability): string => JSON.stringify({ ...a, updatedAt: undefined });

export async function scoreCase(kase: AvailCase): Promise<CaseScore> {
  const exchanges = loadExchanges(kase.id);
  const { result } = await withCase(exchanges, () => getAvailability(kase.operatorId, kase.from, kase.days));
  const capped = cappedDates(result);
  const uncapped = <T extends string>(set: Set<T>) => new Set([...set].filter((x) => !capped.has(x.slice(0, 10))));
  return {
    kase,
    answer: result,
    findings: runChecks({ kase, answer: result, exchanges }),
    readerStarts: uncapped(startsOf(result)),
    crossStarts: uncapped(crossRead(kase.vendor, exchanges, kase.from, kase.days)),
    capped,
    stable: comparable(result) === comparable(kase.observed),
  };
}

export async function scoreAll(): Promise<CaseScore[]> {
  const out: CaseScore[] = [];
  for (const kase of loadCases()) out.push(await scoreCase(kase));
  return out;
}

const pct = (n: number, d: number) => (d ? ((100 * n) / d).toFixed(1) + "%" : "n/a");

export async function report(opts: { json?: boolean } = {}): Promise<string> {
  const scores = await scoreAll();
  if (!scores.length) return 'No cases recorded yet. Run "npm run avail:capture" first.';
  if (opts.json) return JSON.stringify(scores.map((s) => ({ id: s.kase.id, stable: s.stable, findings: s.findings, reader: [...s.readerStarts].length, cross: [...s.crossStarts].length })), null, 1);

  const L: string[] = [];
  L.push(`Availability corpus: ${scores.length} recorded shops\n`);

  // ---- per vendor
  L.push("Vendor       cases  live  stable  slots   reader vs second read");
  for (const vendor of ["fareharbor", "peek", "xola"] as const) {
    const v = scores.filter((s) => s.kase.vendor === vendor);
    if (!v.length) continue;
    const live = v.filter((s) => s.answer.live).length;
    const stable = v.filter((s) => s.stable).length;
    const slots = v.reduce((n, s) => n + s.readerStarts.size, 0);
    const hit = v.reduce((n, s) => n + [...s.readerStarts].filter((x) => s.crossStarts.has(x)).length, 0);
    const crossTotal = v.reduce((n, s) => n + s.crossStarts.size, 0);
    const capped = v.reduce((n, s) => n + s.capped.size, 0);
    L.push(
      vendor.padEnd(13) +
        String(v.length).padStart(5) +
        String(live).padStart(6) +
        String(stable).padStart(8) +
        String(slots).padStart(7) +
        `   precision ${pct(hit, slots)}  recall ${pct(hit, crossTotal)}` +
        (capped ? `  (${capped} full day(s) at the ${SLOT_CAP} slot cap left out)` : ""),
    );
  }

  // ---- the rule checks
  L.push("\nRule checks (each one a thing a guest would see):");
  const byCheck = new Map<string, Finding[]>();
  for (const s of scores) for (const f of s.findings) byCheck.set(f.check, [...(byCheck.get(f.check) || []), f]);
  for (const c of CHECKS) {
    const hits = byCheck.get(c.id) || [];
    const cases = new Set(scores.filter((s) => s.findings.some((f) => f.check === c.id)).map((s) => s.kase.id));
    const mark = hits.length ? (hits.every((h) => h.level === "warn") ? "warn" : "FAIL") : "pass";
    L.push(`  ${mark.padEnd(5)} ${c.id.padEnd(26)} ${hits.length ? `${hits.length} finding(s) across ${cases.size} case(s)` : ""}`);
    if (hits.length) L.push(`        why: ${c.why}`);
    for (const h of hits.slice(0, 3)) L.push(`        - ${h.detail}`);
    if (hits.length > 3) L.push(`        ... and ${hits.length - 3} more`);
  }

  // ---- where the two readings disagree, which is where a person should look
  const disagreeing = scores
    .map((s) => ({ s, only: [...s.crossStarts].filter((x) => !s.readerStarts.has(x)), extra: [...s.readerStarts].filter((x) => !s.crossStarts.has(x)) }))
    .filter((d) => d.only.length || d.extra.length)
    .sort((a, b) => b.only.length + b.extra.length - (a.only.length + a.extra.length));
  L.push(`\nDisagreements with the second read: ${disagreeing.length} of ${scores.length} cases`);
  for (const d of disagreeing.slice(0, 12)) {
    L.push(
      `  ${d.s.kase.id.padEnd(40)} feed has ${String(d.only.length).padStart(4)} the reader does not, reader has ${String(d.extra.length).padStart(4)} the feed does not`,
    );
    if (d.only.length) L.push(`      missed e.g. ${d.only.slice(0, 4).join(", ")}`);
    if (d.extra.length) L.push(`      invented e.g. ${d.extra.slice(0, 4).join(", ")}`);
  }

  // ---- adjudicated truth, where there is any
  const judged = scores.map((s) => ({ s, t: loadTruth(s.kase.id) })).filter((x) => x.t);
  L.push(`\nAdjudicated truth: ${judged.length} of ${scores.length} cases`);
  if (!judged.length) {
    L.push('  None yet. "npm run avail:judge" has a model read each recording and say what the answer should');
    L.push("  have been, independently of the reader. That one costs money, so it is never run automatically.");
  } else {
    let tp = 0;
    let fp = 0;
    let fn = 0;
    let liveRight = 0;
    for (const { s, t } of judged) {
      const truth = new Set(t!.starts);
      for (const x of s.readerStarts) (truth.has(x) ? tp++ : fp++);
      for (const x of truth) if (!s.readerStarts.has(x)) fn++;
      if (t!.live === s.answer.live) liveRight++;
    }
    L.push(`  "is anything bookable at all" correct on ${liveRight}/${judged.length} (${pct(liveRight, judged.length)})`);
    L.push(`  start times: precision ${pct(tp, tp + fp)}, recall ${pct(tp, tp + fn)}  (${tp} right, ${fp} invented, ${fn} missed)`);
    const bySource = new Map<string, number>();
    for (const { t } of judged) bySource.set(t!.source, (bySource.get(t!.source) || 0) + 1);
    L.push("  decided by: " + [...bySource].map(([k, v]) => `${k} ${v}`).join(", "));
  }

  const unstable = scores.filter((s) => !s.stable);
  if (unstable.length) {
    L.push(`\nChanged since capture: ${unstable.length} case(s) replay differently than when recorded.`);
    for (const s of unstable.slice(0, 8)) L.push("  " + s.kase.id);
    L.push("  Either the reader changed on purpose, in which case re-capture, or it regressed.");
  }
  return L.join("\n");
}

/**
 * Accept the reader's current answers as the new baseline, from the recordings alone.
 *
 * For use after a deliberate fix, and only then. The recorded bytes do not change, so nothing is crawled and
 * no vendor is troubled: what changes is our reading of them, which is exactly what `observed` records. The
 * alternative, re-capturing, would fetch a different fortnight from every shop and throw away the evidence
 * that the old answers were wrong.
 *
 * It prints what moved, so a re-baseline that quietly swallows a regression is at least visible in the diff.
 */
export async function rebaseline(): Promise<string> {
  const out: string[] = [];
  for (const kase of loadCases()) {
    const exchanges = loadExchanges(kase.id);
    const { result } = await withCase(exchanges, () => getAvailability(kase.operatorId, kase.from, kase.days));
    if (comparable(result) === comparable(kase.observed)) continue;
    const before = kase.observed.days.reduce((n, d) => n + d.slots.length, 0);
    const after = result.days.reduce((n, d) => n + d.slots.length, 0);
    saveCase({ ...kase, observed: result }, exchanges);
    out.push(`  ${kase.id.padEnd(42)} ${before} slots -> ${after}`);
  }
  return out.length ? `Re-baselined ${out.length} case(s) from their existing recordings:\n` + out.join("\n") : "Nothing to re-baseline: every case already replays as recorded.";
}
