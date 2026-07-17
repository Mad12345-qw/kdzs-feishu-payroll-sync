import test from "node:test";
import assert from "node:assert/strict";
import { payrollAmount } from "../src/utils.js";
import { NewPayrollService } from "../src/new-payroll.js";

test("工资按底薪、绩效、奖金、正利润提成和扣款计算", () => {
  assert.equal(payrollAmount({ baseSalary: 6500, performance: 1200, bonus: 100, storeProfit: 30215.66, commissionRate: 0.03, deduction: 100 }), 8606.47);
});

test("亏损店铺提成为零而不是负数", () => {
  assert.equal(payrollAmount({ baseSalary: 5000, storeProfit: -10000, commissionRate: 0.1 }), 5000);
});

test("工资统一保留两位小数", () => {
  assert.equal(payrollAmount({ baseSalary: 0, storeProfit: 100, commissionRate: 0.033333 }), 3.33);
});

test("人员表调整底薪和提成后自动刷新待结算工资", async () => {
  const updates = [];
  const feishu = {
    listRecords: async (tableId) => tableId === "people" ? [{ fields: {
      "姓名": "主播A", "所属店铺": "店铺A", "基本工资": 7000, "提成百分比": 0.05, "在职状态": "在职",
    } }] : [{ record_id: "payroll-1", fields: {
      "姓名": "主播A", "月份": Date.parse("2026-07-01T00:00:00+08:00"), "店铺": "旧店铺",
      "基本工资": 6000, "提成比例": 0.03, "绩效工资": 500, "结算状态": "待结算",
    } }],
    batchCreate: async () => [],
    batchUpdate: async (_tableId, rows) => { updates.push(...rows); return rows; },
  };
  const service = new NewPayrollService({ feishu, tables: { people: { id: "people" }, payrollSettlement: { id: "payroll" } } });
  const result = await service.prepareMonth("2026-07");
  assert.equal(result.updated, 1);
  assert.deepEqual(updates[0].fields, { "店铺": "店铺A", "基本工资": 7000, "提成比例": 0.05 });
});

test("人员表调整不会改动已结算工资快照", async () => {
  let updateCount = 0;
  const feishu = {
    listRecords: async (tableId) => tableId === "people" ? [{ fields: {
      "姓名": "主播A", "所属店铺": "店铺A", "基本工资": 8000, "提成百分比": 0.08,
    } }] : [{ record_id: "payroll-1", fields: {
      "姓名": "主播A", "月份": Date.parse("2026-07-01T00:00:00+08:00"), "店铺": "店铺A",
      "基本工资": 6000, "提成比例": 0.03, "结算状态": "已结算",
    } }],
    batchCreate: async () => [],
    batchUpdate: async () => { updateCount += 1; },
  };
  const service = new NewPayrollService({ feishu, tables: { people: { id: "people" }, payrollSettlement: { id: "payroll" } } });
  const result = await service.prepareMonth("2026-07");
  assert.equal(result.updated, 0);
  assert.equal(updateCount, 0);
});
