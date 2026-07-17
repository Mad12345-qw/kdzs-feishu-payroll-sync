import test from "node:test";
import assert from "node:assert/strict";
import { FeishuClient } from "../src/feishu-client.js";

test("批量写入遇到单条坏数据时隔离失败记录，不阻断其他记录", async () => {
  const client = new FeishuClient({ baseToken: "base" });
  client.request = async (_method, _endpoint, body) => {
    if (body.records.some((record) => record.fields.bad)) throw new Error("字段不合法");
    return { records: body.records.map((record, index) => ({ record_id: `r${index}`, fields: record.fields })) };
  };
  const result = await client.batchCreateSafe("table", [
    { "同步唯一键": "A", value: 1 },
    { "同步唯一键": "B", bad: true },
    { "同步唯一键": "C", value: 3 },
  ]);
  assert.equal(result.succeeded.length, 2);
  assert.deepEqual(result.failures, [{ key: "B", reason: "字段不合法" }]);
});
