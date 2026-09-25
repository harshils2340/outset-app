/**
 * How long one address is left alone after a campaign has mailed it.
 *
 * Two pitches now share this table and one Gmail identity: the claim-your-free-listing email (kind =
 * 'listing') and the Otto phone-line email (kind = 'otto'). Each send query already refused an address its
 * own campaign had mailed, and neither could see the other's sends, so the same owner could get two
 * different cold pitches from the same personal address days apart. ottoDrafts.ts says in its own header that
 * "the two must never be sent to the same address inside the same week"; nothing enforced it.
 *
 * It is not a rare corner. Over the shipped catalog 2,038 operators clear both campaigns' filters, 68% of
 * everything the listing pitch can send to, and both queues order by how well established a shop is, so the
 * overlap sits at the top of both. Two pitches from one personal mailbox inside a week is what an owner reads
 * as a mailing list and marks as spam, and that mark lands on the one account the whole channel runs on.
 */

/** Days one address is left alone after any campaign mailed it, before another campaign may. */
export const CROSS_CAMPAIGN_DAYS = 7;

/**
 * The instant a send stops standing in the way of the other campaign. Sends at or after it block; anything
 * older does not. Written in the same UTC ISO shape `outreach_drafts.created_at` holds, which the send path
 * rewrites to the moment the mail actually went out.
 */
export function cooloffStart(now: Date = new Date(), days: number = CROSS_CAMPAIGN_DAYS): string {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}

/**
 * Whether this campaign may mail an address, given every send already on it. `ownKind` is the campaign
 * asking. Its own sends bar the address for good, one pitch per address per campaign; another campaign's
 * sends bar it only until the cool-off passes.
 */
export function maySend(
  sends: { kind: string; createdAt: string }[],
  ownKind: string,
  now: Date = new Date(),
  days: number = CROSS_CAMPAIGN_DAYS,
): boolean {
  const cutoff = cooloffStart(now, days);
  return !sends.some((s) => s.kind === ownKind || s.createdAt >= cutoff);
}

/**
 * The clause both send queries carry, over a drafts row aliased `d`. One bound parameter, the cool-off start,
 * and it must be bound in the order the clause appears in the statement. Any kind counts against the window,
 * not just the two that exist today, so a third pitch is spaced from both without touching this again.
 */
export function noRecentSendSql(ownKind: "listing" | "otto"): string {
  return (
    `NOT EXISTS (SELECT 1 FROM outreach_drafts s WHERE s.to_email = d.to_email AND s.status = 'sent'` +
    ` AND (s.kind = '${ownKind}' OR s.created_at >= ?))`
  );
}
