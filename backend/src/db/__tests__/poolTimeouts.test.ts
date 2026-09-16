import { test } from "node:test";
import assert from "node:assert/strict";
import { POOL_TIMEOUTS } from "../pg.ts";

/**
 * A query with no ceiling on it holds one of five connections for as long as Postgres feels like taking. Five
 * of those and the API answers nothing at all: a guest opening a listing waited the pool's full fifteen second
 * connection timeout and was then given a 500, for a database that was merely slow. Measured against a local
 * cluster, `select pg_sleep(12)` ran the whole twelve seconds before this and is cancelled at ten now.
 */

test("every connection has a ceiling on how long it can be held", () => {
  assert.ok(POOL_TIMEOUTS.statement_timeout > 0, "Postgres must cancel a query of its own accord");
  assert.ok(POOL_TIMEOUTS.query_timeout > POOL_TIMEOUTS.statement_timeout, "the client backstop fires after Postgres has had its chance");
  assert.ok(POOL_TIMEOUTS.idle_in_transaction_session_timeout > 0, "an abandoned transaction must not hold a listing's advisory lock for ever");
});

test("the ceilings leave room for the API's own queries and stay under the connection timeout budget", () => {
  // The slowest read the API makes is /listing-edits, which is 5,000 small rows.
  assert.ok(POOL_TIMEOUTS.statement_timeout >= 5_000);
  assert.ok(POOL_TIMEOUTS.query_timeout <= 15_000);
});
