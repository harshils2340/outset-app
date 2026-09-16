import "./env.ts";
import { serve } from "@hono/node-server";
import { app } from "./api/routes.ts";
import { migratePg, pgConfigured } from "./db/pg.ts";
import { startDeployWindow } from "./lib/deployWindow.ts";

/**
 * The API's own entry point.
 *
 * `index.ts` is the command line: it statically imports every command it can run, which is most of the
 * crawlers, the enrichers, the discovery passes and the sync. Serving went through that file, so the API paid
 * for all of it before it answered anything, on an instance that spins down when idle. This imports only what
 * serving needs.
 *
 * `index.ts serve` still works and is unchanged, for a laptop that wants one process for everything.
 */

if (!pgConfigured()) {
  console.error("DATABASE_URL is not set. Profiles and bookings live in Postgres; the API will not serve without it.");
  process.exit(1);
}

await migratePg();

const port = Number(process.env.PORT || 8787);
serve({ fetch: app.fetch, port });
console.log("Outset backend on http://localhost:" + port);
// Overnight sessions push all night; Render builds nothing between 4am and 10am Eastern and deploys once at the end.
startDeployWindow();

/**
 * The seed rows the admin-only /operators and /contacts routes read. They go in after the socket is listening,
 * so a guest arriving at a cold instance is not waiting on them, and a failure here leaves the API serving.
 */
void import("./ingest/load.ts")
  .then((m) => {
    m.seedTaxonomy();
    m.ingestAll();
  })
  .catch((e) => console.error("[serve] seed skipped: " + (e as Error).message));
