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
