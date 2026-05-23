import assert from "node:assert/strict";
import test from "node:test";
import { applyTemporalDecay } from "./recommendations.js";
import type { SwipeInteractionRecord } from "./types.js";

const now = new Date("2026-01-01T00:00:00Z");

function makeInteraction(daysAgo: number, id = `i-${daysAgo}`): SwipeInteractionRecord {
  return {
    id,
    actorUserId: "actor-1",
    targetType: "campaign",
    targetId: "target-1",
    action: "like",
    createdAt: new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000)
  };
}

test("applyTemporalDecay keeps fresh, marks middle-aged, drops ancient", () => {
  const fresh = makeInteraction(5, "fresh");
  const middle = makeInteraction(45, "middle");
  const ancient = makeInteraction(120, "ancient");

  const { kept, lowConfidence } = applyTemporalDecay([fresh, middle, ancient], now);

  assert.equal(kept.length, 2);
  assert.ok(kept.find((i) => i.id === "fresh"));
  assert.ok(kept.find((i) => i.id === "middle"));
  assert.equal(lowConfidence.has("middle"), true);
  assert.equal(lowConfidence.has("fresh"), false);
});
