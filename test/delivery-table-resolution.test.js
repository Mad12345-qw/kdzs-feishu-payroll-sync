import test from "node:test";
import assert from "node:assert/strict";
import { DELIVERY_TABLES, DeliverySyncService } from "../src/delivery-sync.js";

test("交付同步按表名解析客户副本中的新表 ID", async () => {
  const tables = Object.values(DELIVERY_TABLES).map((table, index) => ({
    name: table.name, table_id: `new-table-${index}`,
  }));
  const service = new DeliverySyncService({
    feishu: { listTables: async () => tables }, kdzs: {}, logger: { info() {} },
  });
  const resolved = await service.resolveBusinessTables();
  assert.equal(resolved.storeProfit.id, "new-table-0");
  assert.equal(resolved.payroll.id, "new-table-8");
  assert.equal(resolved.people.id, "new-table-7");
});

test("成功同步会清空客户副本遗留的失败原因", async () => {
  const writes = [];
  const service = new DeliverySyncService({
    feishu: { upsert: async (_tableId, rows) => { writes.push(...rows); return { total: 1, created: 0, updated: 1, failed: 0 }; } },
    kdzs: {}, logger: { info() {} },
  });
  service.tables.logs = { id: "logs", name: "16_同步日志" };
  await service.logDay("2026-07-17", { "状态": "成功" });
  assert.equal(writes[0]["失败原因"], "");
});
