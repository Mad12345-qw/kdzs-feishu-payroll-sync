import test from "node:test";
import assert from "node:assert/strict";
import { dateOnly, monthBounds } from "../src/utils.js";

test("月份边界按北京时间计算且不跨错月份", () => {
  const june = monthBounds("2026-06");
  assert.equal(dateOnly(june.start), "2026-06-01");
  assert.equal(dateOnly(june.end), "2026-06-30");
  const december = monthBounds("2026-12");
  assert.equal(dateOnly(december.start), "2026-12-01");
  assert.equal(dateOnly(december.end), "2026-12-31");
});
