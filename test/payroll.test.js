import test from "node:test";
import assert from "node:assert/strict";
import { payrollAmount } from "../src/utils.js";

test("工资按底薪、绩效、奖金、正利润提成和扣款计算", () => {
  assert.equal(payrollAmount({ baseSalary: 6500, performance: 1200, bonus: 100, storeProfit: 30215.66, commissionRate: 0.03, deduction: 100 }), 8606.47);
});

test("亏损店铺提成为零而不是负数", () => {
  assert.equal(payrollAmount({ baseSalary: 5000, storeProfit: -10000, commissionRate: 0.1 }), 5000);
});

test("工资统一保留两位小数", () => {
  assert.equal(payrollAmount({ baseSalary: 0, storeProfit: 100, commissionRate: 0.033333 }), 3.33);
});
