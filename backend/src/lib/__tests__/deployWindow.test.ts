import test from "node:test";
import assert from "node:assert/strict";
import { inQuietWindow } from "../deployWindow.ts";

test("the quiet window is 4am to 10am Eastern, whatever the clock's zone", () => {
  // 08:30 UTC on 16 September 2026 is 04:30 EDT: quiet. 07:30 UTC is 03:30 EDT: not yet.
  assert.equal(inQuietWindow(new Date("2026-09-16T08:30:00Z")), true);
  assert.equal(inQuietWindow(new Date("2026-09-16T07:30:00Z")), false);
  // 13:59 UTC is 09:59 EDT: still quiet. 14:00 UTC is 10:00 EDT: open.
  assert.equal(inQuietWindow(new Date("2026-09-16T13:59:00Z")), true);
  assert.equal(inQuietWindow(new Date("2026-09-16T14:00:00Z")), false);
  // In January the offset is EST: 09:00 UTC is 04:00 EST, quiet; 15:00 UTC is 10:00 EST, open.
  assert.equal(inQuietWindow(new Date("2026-01-16T09:00:00Z")), true);
  assert.equal(inQuietWindow(new Date("2026-01-16T15:00:00Z")), false);
});
