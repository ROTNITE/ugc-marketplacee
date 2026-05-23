import assert from "node:assert/strict";
import test from "node:test";
import { getHealthPayload } from "./health.js";

test("returns API health payload", () => {
  assert.deepEqual(getHealthPayload(), {
    ok: true,
    service: "api"
  });
});
