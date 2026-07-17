import test from "node:test";
import assert from "node:assert/strict";
import { createKdzsFromSessionTable } from "../src/session-provider.js";

test("从系统-session读取 ERP 凭证且不输出密钥", async () => {
  const feishu = {
    listRecords: async () => [{ record_id: "r1", fields: { appKey: "key", secret: "secret", session: "session" } }],
    batchUpdate: async () => [],
  };
  const client = await createKdzsFromSessionTable(feishu, {
    runtime: { sessionTableId: "table" },
    kdzs: { gateway: "https://example.com", tokenUrl: "https://example.com/token" },
  });
  assert.equal(client.config.appKey, "key");
  assert.equal(client.session, "session");
});
