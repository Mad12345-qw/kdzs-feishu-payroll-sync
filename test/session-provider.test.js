import test from "node:test";
import assert from "node:assert/strict";
import { createDeliveryKdzsClient, createKdzsFromSessionTable } from "../src/session-provider.js";

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

test("Render 环境变量中的 ERP 凭证优先于飞书 Session 表", async () => {
  const client = await createDeliveryKdzsClient({
    feishu: null,
    config: { kdzs: { appKey: "env-key", appSecret: "env-secret", session: "env-session", gateway: "https://example.com", tokenUrl: "https://example.com/token" } },
  });
  assert.equal(client.config.appKey, "env-key");
  assert.equal(client.session, "env-session");
});
