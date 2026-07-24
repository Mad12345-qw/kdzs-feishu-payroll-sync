import test from "node:test";
import assert from "node:assert/strict";
import { classifyAfterSalesResponsibility, DeliverySyncService } from "../src/delivery-sync.js";

test("客服标准备注自动匹配无责任方和三个责任岗位", () => {
  assert.deepEqual(classifyAfterSalesResponsibility("【客户个人原因，无责任方】"), { type: "客户个人原因", role: "", mode: "无责任方" });
  assert.equal(classifyAfterSalesResponsibility("【发错货，责任：中控】").role, "中控");
  assert.equal(classifyAfterSalesResponsibility("【使用讲解不清，责任：助播】").role, "助播");
  assert.equal(classifyAfterSalesResponsibility("【讲解夸大，责任：主播】").role, "主播");
  assert.equal(classifyAfterSalesResponsibility("备注不规范").mode, "待人工标记");
});

test("揽收后退款自动收回全部原提成并向责任岗位分摊2.5元", async () => {
  const service = new DeliverySyncService({ feishu: {}, kdzs: {} });
  service.tables.adjustments = { id: "adjustments" };
  service.loadCommissionLedger = async () => new Map([["T-1", [{
    "订单编号": "T-1", "原成交日期": Date.parse("2026-07-01T00:00:00+08:00"), "揽收时间": "2026-07-02 10:00:00", "店铺": "测试店",
    "人员提成JSON": JSON.stringify([
      { name: "主播A", role: "主播", amount: 6 },
      { name: "中控A", role: "中控", amount: 2.5 },
      { name: "助播A", role: "助播", amount: 1.5 },
    ]),
  }]]]);
  let written = [];
  service.upsert = async (_table, rows) => { written = rows; return { total: rows.length, created: rows.length, updated: 0, failed: 0, failures: [] }; };
  await service.syncAutomaticAfterSalesAdjustments([{
    tid: "T-1", refundId: "R-1", refundAmount: 100, refundStatus: "退款成功", remark: "发错货，责任：中控",
  }], "2026-07-23");
  assert.equal(written.filter((row) => row["扣款类型"] === "提成回退").length, 3);
  assert.equal(written.filter((row) => row["扣款类型"] === "提成回退").reduce((total, row) => total + row["金额"], 0), 10);
  const loss = written.find((row) => row["扣款类型"] === "售后损耗分摊");
  assert.equal(loss["姓名"], "中控A");
  assert.equal(loss["金额"], 2.5);
  assert.equal(loss["店铺承担金额"], 2.5);
  assert.equal(loss["客服原始备注"], "发错货，责任：中控");
});

test("无责任备注只生成提成回退，不生成售后损耗分摊", async () => {
  const service = new DeliverySyncService({ feishu: {}, kdzs: {} });
  service.tables.adjustments = { id: "adjustments" };
  service.loadCommissionLedger = async () => new Map([["T-2", [{
    "订单编号": "T-2", "原成交日期": Date.now(), "揽收时间": "2026-07-02 10:00:00", "店铺": "测试店",
    "人员提成JSON": JSON.stringify([{ name: "主播A", role: "主播", amount: 5 }]),
  }]]]);
  let written = [];
  service.upsert = async (_table, rows) => { written = rows; return { total: rows.length, created: rows.length, updated: 0, failed: 0, failures: [] }; };
  await service.syncAutomaticAfterSalesAdjustments([{
    tid: "T-2", refundAmount: 100, refundStatus: "退款成功", remark: "客户个人原因，无责任方",
  }], "2026-07-23");
  assert.equal(written.length, 1);
  assert.equal(written[0]["扣款类型"], "提成回退");
});
