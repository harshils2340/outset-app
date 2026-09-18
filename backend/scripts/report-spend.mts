import "../src/env.ts";
import { paidSpendByDayUsd, paidSpendUsd } from "../src/discover/aisearch.ts";

/**
 * Post what this worker has spent to the live API, so the internal metrics page can show it.
 *
 * Discovery and extraction spend is counted here and nowhere else: two ledger files beside this clone and the
 * `extract_spend` table in the SQLite database on the worker's disk. The deployed API has neither, so without
 * this the cost half of the page would be permanently blank. `paidSpendUsd()` is the one function that adds all
 * three sources up, including the Google Maps requests the aisearch ledger knows nothing about, so it is what is
 * read here rather than any ledger on its own.
 *
 *   npx tsx scripts/report-spend.mts
 *
 * It never fails the pipeline. No ADMIN_KEY, no API_URL, no network, or an API that answers anything but 200:
 * all of it is one line on stdout and exit 0. A snapshot that did not arrive tonight is a page showing last
 * night's figure with its own timestamp beside it, which is a small and honest problem; a pipeline that stopped
 * because the accounting failed is a large one.
 */

const API = (process.env.API_URL || "").trim().replace(/\/+$/, "");
const KEY = (process.env.ADMIN_KEY || "").trim();
const CAP = Number(process.env.PAID_CAP_USD || 20);

async function main(): Promise<void> {
  if (!API || !KEY) {
    console.log(`spend: ${!API ? "API_URL" : "ADMIN_KEY"} is not set on this worker, so there is nowhere to report to; nothing sent`);
    return;
  }
  const spend = paidSpendUsd();
  const byDay = paidSpendByDayUsd();
  const body = {
    discovery: spend.discovery,
    extraction: spend.extraction,
    total: spend.total,
    capUsd: Number.isFinite(CAP) ? CAP : null,
    at: new Date().toISOString(),
    byDay,
  };
  console.log(`spend: discovery $${spend.discovery.toFixed(2)}, extraction $${spend.extraction.toFixed(2)}, total $${spend.total.toFixed(2)} of $${CAP}, ${byDay.length} days`);

  const res = await fetch(API + "/admin/spend", {
    method: "POST",
    headers: { "content-type": "application/json", "x-admin-key": KEY },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) {
    console.log(`spend: ${API}/admin/spend answered ${res.status}; snapshot not stored`);
    return;
  }
  console.log("spend: snapshot stored");
}

try {
  await main();
} catch (e) {
  console.log("spend: " + (e as Error).message + "; nothing stored");
}
