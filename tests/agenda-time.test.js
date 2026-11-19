import test from "node:test";
import assert from "node:assert/strict";
import { currentTimePosition } from "../src/lib/agenda-time.js";

test("positions the current time on the Algeria day and selected scale", () => {
  const now = new Date("2026-11-19T09:30:45Z");
  assert.equal(currentTimePosition(now, "2026-11-19", 9 * 60, 18 * 60, 40 / 30), 120);
  assert.equal(currentTimePosition(now, "2026-11-19", 9 * 60, 18 * 60, 40 / 60), 60);
  assert.equal(currentTimePosition(now, "2026-11-20", 0, 1440, 1), null);
});

test("uses Algeria's calendar date around midnight and hides the line outside the grid", () => {
  const now = new Date("2026-11-19T23:15:00Z");
  assert.equal(currentTimePosition(now, "2026-11-20", 0, 60, 1), 15);
  assert.equal(currentTimePosition(now, "2026-11-19", 0, 1440, 1), null);
  assert.equal(currentTimePosition(now, "2026-11-20", 30, 60, 1), null);
  assert.equal(currentTimePosition(now, "2026-11-20", 0, 15, 1), null);
});
