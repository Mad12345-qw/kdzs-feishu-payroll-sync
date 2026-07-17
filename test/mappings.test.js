import test from "node:test";
import assert from "node:assert/strict";
import { mapOrders, mapRefunds, mapStoreProfit } from "../src/mappings.js";

test("订单以系统单号和子订单号去重", () => {
  const trade = { tid: "T1", ptTid: "P1", sellerNick: "店铺", orderList: [{ oid: "O1", number: 1 }, { oid: "O1", number: 2 }] };
  const rows = mapOrders([trade]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]["同步唯一键"], "T1|O1");
  assert.equal(rows[0]["数量"], 2);
});

test("同一退款单同一 SKU 合并，避免重复扣款", () => {
  const rows = mapRefunds([{ refundId: "R1", items: [
    { outerSkuId: "S1", title: "商品", skuProperties: "红", refundNum: 1, refundAmount: 10 },
    { outerSkuId: "S1", title: "商品", skuProperties: "红", refundNum: 2, refundAmount: 20 },
  ] }]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]["售后数量"], 3);
  assert.equal(rows[0]["商品退款金额"], 30);
});

test("店铺利润直接采用 ERP netSalesProfit", () => {
  const [row] = mapStoreProfit([{ platform: "fxg", sellerNick: "店铺", netSalesProfit: -12.345 }], "2026-06-30");
  assert.equal(row["利润"], -12.345);
  assert.equal(row["平台类型"], "抖音");
});
