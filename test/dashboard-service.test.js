import test from "node:test";
import assert from "node:assert/strict";
import { DashboardService } from "../src/dashboard-service.js";

function fakeFeishu() {
  const tables = [
    { name: "01_每日财务汇总", table_id: "overview" }, { name: "13_人员表", table_id: "people" },
    { name: "10_库存快照", table_id: "stock" }, { name: "03_商品利润明细", table_id: "products" },
  ];
  const records = {
    overview: [
      { fields: { "日期": Date.parse("2026-07-20T00:00:00+08:00"), "店铺名称": "测试店", "平台类型": "抖音", "销售金额": 1000, "利润": 200, "订单数": 10, "实发数量": 8, "退款金额": 30, "退款数量": 1 } },
      { fields: { "日期": Date.parse("2026-07-19T00:00:00+08:00"), "店铺名称": "测试店", "平台类型": "抖音", "销售金额": 800, "利润": 160, "订单数": 8, "实发数量": 7 } },
    ],
    people: [{ fields: { "姓名": "主播A", "角色": "主播", "所属店铺": "测试店", "提成百分比": 0.03, "下单提成比例": 0.03, "发货提成比例": 0.02, "月结提成比例": 0.01, "启用提成展示": "是" } }],
    stock: [],
    products: [{ fields: { "日期": Date.parse("2026-07-20T00:00:00+08:00"), "商品名称": "商品A", "销售金额": 600, "销售数量": 6, "利润": 120 } }],
    deductions: [{ fields: { "日期": Date.parse("2026-07-20T00:00:00+08:00"), "姓名": "主播A", "角色": "主播", "店铺": "测试店", "类型": "错发", "金额": 1, "说明": "错发一件" } }],
  };
  return {
    listTables: async () => tables,
    ensureField: async () => ({}),
    batchUpdateSafe: async () => ({ succeeded: [], failures: [] }),
    batchCreateSafe: async () => ({ succeeded: [], failures: [] }),
    ensureTable: async (name) => {
      if (!tables.find((table) => table.name === name)) tables.push({ name, table_id: "deductions" });
      return tables.find((table) => table.name === name);
    },
    listRecords: async (tableId) => records[tableId] || [],
  };
}

test("经营看板只用 ERP 利润乘人员表比例，并扣除明细表金额", async () => {
  const service = new DashboardService({ feishu: fakeFeishu(), cacheSeconds: 15 });
  const dashboard = await service.getDashboard({ date: "2026-07-20", store: "测试店", platform: "抖音", basis: "placed" });
  assert.equal(dashboard.summary.sales, 1000);
  assert.equal(dashboard.summary.profit, 200);
  assert.equal(dashboard.summary.shippedCount, 7);
  assert.equal(dashboard.summary.misShipmentLoss, 1);
  assert.equal(dashboard.commissions[0].grossCommission, 6);
  assert.equal(dashboard.commissions[0].commission, 5);
});

test("三种提成口径分别使用当日、昨日和整月 ERP 利润", async () => {
  const service = new DashboardService({ feishu: fakeFeishu(), cacheSeconds: 15 });
  const placed = await service.getDashboard({ date: "2026-07-20", store: "测试店", basis: "placed" });
  const shipped = await service.getDashboard({ date: "2026-07-20", store: "测试店", basis: "shipped" });
  const monthly = await service.getDashboard({ date: "2026-07-20", store: "测试店", basis: "monthly" });
  assert.equal(placed.commissions[0].grossCommission, 6);
  assert.equal(shipped.commissions[0].grossCommission, 3.2);
  assert.equal(monthly.commissions[0].grossCommission, 3.6);
});

test("看板实时提成口径分别请求 ERP 的下单和发货时间类型", async () => {
  const calls = [];
  const kdzs = { listAll: async (method, params) => {
    calls.push({ method, params });
    if (method === "kdzs.erp.api.trade.list") return [];
    return [{ sellerNick: "测试店", platform: "抖音", netSalesProfit: params.queryTimeType === 1 ? 500 : 300 }];
  } };
  const service = new DashboardService({ feishu: fakeFeishu(), getKdzs: async () => kdzs, cacheSeconds: 15 });
  const placed = await service.getDashboard({ date: "2026-07-20", store: "测试店", basis: "placed" });
  const shipped = await service.getDashboard({ date: "2026-07-20", store: "测试店", basis: "shipped" });
  const monthly = await service.getDashboard({ date: "2026-07-20", store: "测试店", basis: "monthly" });
  assert.deepEqual(calls.filter((item) => item.method === "kdzs.erp.api.report.gross.profit").map((item) => item.params.queryTimeType), [1, 3, 1, 3, 1]);
  assert.equal(placed.commissions[0].grossCommission, 15);
  assert.equal(placed.summary.profit, 500);
  assert.equal(shipped.commissions[0].grossCommission, 6);
  assert.equal(monthly.commissions[0].grossCommission, 3);
});

test("当天订单已同步但 ERP 毛利未生成时，不把利润和提成显示为零", async () => {
  const kdzs = { listAll: async (method) => method === "kdzs.erp.api.trade.list"
    ? [{ sellerNick: "测试店", platform: "抖音", payment: 120, receivedPayment: 120 }]
    : [] };
  const service = new DashboardService({ feishu: fakeFeishu(), getKdzs: async () => kdzs, cacheSeconds: 15 });
  const dashboard = await service.getDashboard({ date: "2026-07-21", store: "测试店", basis: "placed" });
  assert.equal(dashboard.summary.orderCount, 1);
  assert.equal(dashboard.summary.sales, 120);
  assert.equal(dashboard.summary.profitPending, true);
  assert.equal(dashboard.summary.profit, null);
  assert.equal(dashboard.commissions[0].commission, null);
});
