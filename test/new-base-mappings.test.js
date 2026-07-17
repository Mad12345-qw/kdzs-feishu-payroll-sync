import test from "node:test";
import assert from "node:assert/strict";
import { mapCuratedStoreProfit, mapNewOrderItems, mapNewOrders, mapNewStoreProfit, mapOrderProfit, mapProductProfit } from "../src/new-base-mappings.js";

test("新 Base 订单主表和明细使用稳定唯一键", () => {
  const trades = [{ tid: "T1", ptTid: "P1", orderList: [{ oid: "O1", number: 2 }] }];
  assert.equal(mapNewOrders(trades)[0]["同步唯一键"], "T1");
  assert.equal(mapNewOrderItems(trades)[0]["同步唯一键"], "T1|O1");
});

test("店铺利润严格采用 ERP netSalesProfit", () => {
  const item = { platform: "抖音", sellerNick: "店铺", payment: 100, netSales: 80, netSalesCost: 30, postCost: 5, netSalesProfit: 45, netSalesProfitMargin: 56.25 };
  assert.equal(mapNewStoreProfit([item], "2026-07-01")[0]["利润"], 45);
  const row = mapCuratedStoreProfit([item], "2026-07-01")[0];
  assert.equal(row["利润"], 45);
  assert.equal(row["利润率"], 0.5625);
});

test("订单和商品利润明细使用稳定键且数值字段保持数字", () => {
  const item = { platform: "抖音", sellerNick: "店铺", tid: "T1", orderId: "O1", itemId: "I1", skuId: "S1", payment: "10", netSalesProfit: "3.2", orderStatus: "1" };
  assert.equal(mapOrderProfit([item], "2026-07-01")[0]["同步唯一键"], "2026-07-01|抖音|店铺|T1");
  assert.equal(mapProductProfit([item], "2026-07-01")[0]["利润"], 3.2);
  assert.equal(mapProductProfit([item], "2026-07-01")[0].orderStatus, 1);
});
