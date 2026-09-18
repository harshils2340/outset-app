/**
 * What Render's compute costs, as far as Render is willing to say.
 *
 * The short answer, checked on 18 September 2026 against the full published API index
 * (https://api-docs.render.com/llms.txt, every reference page enumerated): **Render's public REST API exposes
 * no cost, billing, usage-billing or invoice endpoint at all.** The tags are Services, Postgres, Key Value,
 * Deploys, Jobs, Env Groups, Environments, Projects, Blueprints, Domains, Disks, Registry Credentials,
 * Webhooks, Workflows, Logs, Metrics, Notifications, Audit Logs, Users, Workspaces, Maintenance, Snapshots and
 * Dedicated IPs. There is no Billing tag. `/v1/metrics/*` is real but is CPU, memory, bandwidth and disk with a
 * physical `unit` ("GB") and no currency field anywhere; `/v1/owners/{id}` carries no plan, balance or spend.
 * The dashboard's per-service cost breakdown is not backed by any documented public endpoint.
 *
 * So the compute figure is `null` with the reason attached, and never a number. Multiplying the published plan
 * prices by the services we run would produce a confident-looking figure that is a list price and not a bill:
 * it would miss the disk, the bandwidth, and any credit or proration on the account, and a wrong number on a
 * unit-economics page is worse than an empty one. What this does report is a fact the API will answer for:
 * which plan each service is actually on, so the note says what is running even though it cannot say what it
 * billed.
 *
 * Read at most once an hour, and a failure is cached too (briefly), so a slow or sulking Render cannot be
 * called on every page load of a service that is itself on the free plan.
 */

const RENDER = "https://api.render.com/v1";
const TTL_MS = 60 * 60 * 1000;
/** A failure is remembered for less time than a success: a blip should heal within the hour, not after it. */
const FAIL_TTL_MS = 5 * 60 * 1000;

export type ComputeCost = {
  /** Billed spend this calendar month. Always null: see the note above. */
  monthToDate: number | null;
  /** Billed run rate per month. Always null, for the same reason. */
  runRateMonthly: number | null;
  /** Why it is null, and what is running instead. Never null itself. */
  note: string;
  /** What Render says is running, when the key is set and the call worked. */
  services: { name: string; type: string; plan: string | null }[] | null;
};

const NO_BILLING =
  "Render's public API has no cost, billing or invoice endpoint (checked 18 September 2026 against its full published API index); /v1/metrics only reports CPU, memory, bandwidth and disk, with no currency anywhere. " +
  "The billing page in the Render dashboard is the only place the real figure exists, so compute is reported as unknown rather than as a list price guessed from plan names.";

let cache: { at: number; ttl: number; value: ComputeCost } | null = null;

export function clearRenderCostCache(): void {
  cache = null;
}

type Service = { name?: string; type?: string; serviceDetails?: { plan?: string } };

export async function computeCost(now = Date.now()): Promise<ComputeCost> {
  if (cache && now - cache.at < cache.ttl) return cache.value;
  const key = (process.env.RENDER_API_KEY || "").trim();
  const keep = (value: ComputeCost, ttl: number): ComputeCost => {
    cache = { at: now, ttl, value };
    return value;
  };

  if (!key) {
    return keep({ monthToDate: null, runRateMonthly: null, services: null, note: "RENDER_API_KEY is not set on this service, so nothing about the hosting can be read. " + NO_BILLING }, TTL_MS);
  }
  try {
    const res = await fetch(RENDER + "/services?limit=50", {
      headers: { authorization: "Bearer " + key, accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      return keep({ monthToDate: null, runRateMonthly: null, services: null, note: `Render answered ${res.status} for the service list, so not even the plans could be read. ` + NO_BILLING }, FAIL_TTL_MS);
    }
    // The list endpoint wraps each item: [{ service: {...}, cursor: "..." }].
    const body = (await res.json()) as ({ service?: Service } | Service)[];
    const services = (Array.isArray(body) ? body : [])
      .map((row) => ("service" in row && row.service ? row.service : (row as Service)))
      .map((s) => ({ name: String(s?.name || "?"), type: String(s?.type || "?"), plan: s?.serviceDetails?.plan ? String(s.serviceDetails.plan) : null }))
      .filter((s) => s.name !== "?");
    const running = services.length ? "Running now: " + services.map((s) => `${s.name} (${s.type}, ${s.plan || "plan not reported"})`).join(", ") + ". " : "";
    return keep({ monthToDate: null, runRateMonthly: null, services, note: running + NO_BILLING }, TTL_MS);
  } catch (e) {
    return keep({ monthToDate: null, runRateMonthly: null, services: null, note: "Render could not be reached (" + (e as Error).message + "). " + NO_BILLING }, FAIL_TTL_MS);
  }
}
