import test from "node:test";
import assert from "node:assert/strict";
import { KdzsClient } from "../src/kdzs-client.js";

test("后续页 total=-1 时仍按第一页总数继续分页", async () => {
  const client = new KdzsClient({});
  const pages = {
    1: { total: 5, list: [1, 2] },
    2: { total: -1, list: [3, 4] },
    3: { total: -1, list: [5] },
  };
  client.call = async (_method, params) => pages[params.pageNo] || { total: -1, list: [] };
  assert.deepEqual(await client.listAll("test", {}, 2), [1, 2, 3, 4, 5]);
});
