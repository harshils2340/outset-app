/**
 * The lite shard: what the home rails and the first search paint from, before the whole catalog lands.
 *
 * It used to be the 2,200 highest-scored listings outright, and the score rewards a price and a review count,
 * which the water catalog has and the museums, golf courses and campgrounds crawled later do not. So the home
 * painted 577 cruises and 438 fishing charters, then the full catalog arrived and replaced them with museums and
 * golf: a visible flicker into a different site. The shard is a scale model of the browsable catalog now, each
 * kind taking the share of the 2,200 it holds of the whole, and within a kind the best of each metro in turn, so
 * a guest anywhere sees cards and the rails the first paint draws are the rails that stay.
 */

export type LiteRow = { cover?: unknown; from?: unknown; reviews?: unknown; metroId?: unknown; art?: unknown; thin?: unknown };

const LITE_TARGET = 2200;
/** A rail needs six photographed places to exist, so no kind that could form one is sampled below that. */
const RAIL_FLOOR = 6;

export function liteScore(o: LiteRow): number {
  return (o.cover ? 4 : 0) + (o.from != null ? 3 : 0) + Math.min(3, Math.log10((Number(o.reviews) || 0) + 1)) + (o.metroId ? 1 : 0);
}

export function buildLiteShard(operators: LiteRow[], target = LITE_TARGET): LiteRow[] {
  const browsable = operators.filter((o) => !!o.cover && !o.thin);
  const byArt = new Map<string, LiteRow[]>();
  for (const o of browsable) {
    const a = String(o.art || "other");
    const list = byArt.get(a) || [];
    list.push(o);
    byArt.set(a, list);
  }
  const lite: LiteRow[] = [];
  for (const [, rows] of [...byArt].sort((a, b) => b[1].length - a[1].length)) {
    const quota = Math.min(rows.length, Math.max(RAIL_FLOOR, Math.round((target * rows.length) / Math.max(1, browsable.length))));
    const byMetro = new Map<string, LiteRow[]>();
    for (const o of rows) {
      const m = String(o.metroId || "");
      const list = byMetro.get(m) || [];
      list.push(o);
      byMetro.set(m, list);
    }
    for (const list of byMetro.values()) list.sort((a, b) => liteScore(b) - liteScore(a));
    // One from each metro in turn, best first, so a kind is never all one city.
    const queues = [...byMetro.values()];
    let taken = 0;
    for (let round = 0; taken < quota; round++) {
      let movedAny = false;
      for (const q of queues) {
        if (taken >= quota) break;
        if (round >= q.length) continue;
        lite.push(q[round]);
        taken++;
        movedAny = true;
      }
      if (!movedAny) break;
    }
  }
  return lite.sort((a, b) => liteScore(b) - liteScore(a));
}
