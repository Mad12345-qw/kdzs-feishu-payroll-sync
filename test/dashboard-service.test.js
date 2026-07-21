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
    products: [{ fields: { "日期": Date.parse("2026-07-20T00:00:00+08:00"), "店铺名称": "测试店", "平台类型": "抖音", "商品名称": "商品A", "销售金额": 600, "销售数量": 6, "利润": 120 } }],
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

test("经营看板按每件 ERP 利润计算团队提成，并只扣责任人个人金额", async () => {
  const service = new DashboardService({ feishu: fakeFeishu(), cacheSeconds: 15 });
  const dashboard = await service.getDashboard({ date: "2026-07-20", store: "测试店", platform: "抖音", basis: "placed" });
  assert.equal(dashboard.summary.sales, 1000);
  assert.equal(dashboard.summary.profit, 200);
  assert.equal(dashboard.summary.shippedCount, 7);
  assert.equal(dashboard.summary.misShipmentLoss, 1);
  assert.equal(dashboard.commissions[0].grossCommission, 14.4);
  assert.equal(dashboard.commissions[0].commission, 13.4);
});

test("三种提成口径均按其范围内订单商品的逐件规则计算", async () => {
  const service = new DashboardService({ feishu: fakeFeishu(), cacheSeconds: 15 });
  const placed = await service.getDashboard({ date: "2026-07-20", store: "测试店", basis: "placed" });
  const shipped = await service.getDashboard({ date: "2026-07-20", store: "测试店", basis: "shipped" });
  const monthly = await service.getDashboard({ date: "2026-07-20", store: "测试店", basis: "monthly" });
  assert.equal(placed.commissions[0].grossCommission, 14.4);
  assert.equal(shipped.commissions[0].grossCommission, 14.4);
  assert.equal(monthly.commissions[0].grossCommission, 14.4);
});

test("看板实时提成口径分别请求 ERP 的下单和发货时间类型", async () => {
  const calls = [];
  const kdzs = { listAll: async (method, params) => {
    calls.push({ method, params });
    if (method === "kdzs.erp.api.trade.list") return [];
    if (params.queryGroupType === 8) return [{ sellerNick: "测试店", platform: "抖音", itemTitle: "商品A", skuId: "sku", number: 1, payment: 100, netSalesProfit: params.queryTimeType === 1 ? 500 : 300 }];
    return [{ sellerNick: "测试店", platform: "抖音", netSalesProfit: params.queryTimeType === 1 ? 500 : 300 }];
  } };
  const service = new DashboardService({ feishu: fakeFeishu(), getKdzs: async () => kdzs, cacheSeconds: 15 });
  const placed = await service.getDashboard({ date: "2026-07-20", store: "测试店", basis: "placed" });
  const shipped = await service.getDashboard({ date: "2026-07-20", store: "测试店", basis: "shipped" });
  const monthly = await service.getDashboard({ date: "2026-07-20", store: "测试店", basis: "monthly" });
  const profitTypes = calls.filter((item) => item.method === "kdzs.erp.api.report.gross.profit").map((item) => item.params.queryTimeType);
  assert.deepEqual(profitTypes.slice(0, 2), [1, 1]);
  assert.equal(profitTypes.filter((type) => type === 1).length, 2);
  assert.equal(profitTypes.slice(2).every((type) => type === 3), true);
  assert.equal(placed.commissions[0].grossCommission, 3);
  assert.equal(placed.summary.profit, 500);
  assert.equal(shipped.commissions[0].grossCommission, 3);
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

test("昨日实发提成和本月经营汇总分别按独立日期范围读取", async () => {
  const kdzs = { listAll: async (method, params = {}) => {
    if (method === "kdzs.erp.api.trade.list" || method === "kdzs.erp.api.refund.list") return [];
    const day = String(params.startTime || "").slice(0, 10);
    const profit = day === "2026-07-19" ? 50 : day === "2026-07-01" ? 500 : 100;
    if (params.queryGroupType === 8) return [{ sellerNick: "测试店", platform: "抖音", itemTitle: "商品A", skuId: day, number: 1, payment: profit, netSalesProfit: profit }];
    return [{ sellerNick: "测试店", platform: "抖音", netSalesProfit: profit }];
  } };
  const service = new DashboardService({ feishu: fakeFeishu(), getKdzs: async () => kdzs, cacheSeconds: 15 });
  const owner = await service.getDashboard({ date: "2026-07-20", store: "测试店", viewer: { scope: "owner", name: "老板", role: "老板", store: "全部店铺" } });
  const employee = await service.getDashboard({ date: "2026-07-20", store: "测试店", viewer: { scope: "employee", name: "主播A", role: "主播", store: "测试店" } });
  assert.equal(owner.summary.monthProfit, 500);
  assert.equal(owner.summary.monthTeamCommission, 5);
  assert.equal(employee.summary.yesterdayShippedCommission, 3);
});

test("单品团队提成先封顶再按 60/25/15 分配，亏损不产生提成", () => {
  const service = new DashboardService({ feishu: fakeFeishu() });
  const people = [
    { "姓名": "主播", "所属店铺": "测试店", "角色": "主播", "启用提成展示": "是" },
    { "姓名": "中控", "所属店铺": "测试店", "角色": "中控", "启用提成展示": "是" },
    { "姓名": "助播", "所属店铺": "测试店", "角色": "助播", "启用提成展示": "是" },
  ];
  const rules = { "团队计提比例": 0.2, "单件团队封顶": 5, "主播分配比例": 0.6, "中控分配比例": 0.25, "助播分配比例": 0.15 };
  const [capped, loss] = service.calculateProducts([
    { sellerNick: "测试店", platform: "抖音", itemTitle: "高利润商品", skuId: "1", number: 1, payment: 100, netSalesProfit: 100 },
    { sellerNick: "测试店", platform: "抖音", itemTitle: "亏损商品", skuId: "2", number: 1, payment: 20, netSalesProfit: -1 },
  ], rules, people, "2026-07-20", "2026-07-20");
  assert.equal(capped.teamCommission, 5);
  assert.deepEqual(capped.roleCommission, { "主播": 3, "中控": 1.25, "助播": 0.75 });
  assert.equal(loss.teamCommission, 0);
});

test("单件封顶按每个订单商品数量累计，不把全天销量只封顶一次", () => {
  const service = new DashboardService({ feishu: fakeFeishu() });
  const rules = { "团队计提比例": 0.2, "单件团队封顶": 5, "主播分配比例": 0.6, "中控分配比例": 0.25, "助播分配比例": 0.15 };
  const [item] = service.calculateProducts([
    { sellerNick: "测试店", platform: "抖音", itemTitle: "千件商品", skuId: "1000", number: 1000, payment: 100000, netSalesProfit: 100000 },
  ], rules, [], "2026-07-20", "2026-07-20");
  assert.equal(item.teamCommission, 5000);
  assert.deepEqual(item.roleCommission, { "主播": 3000, "中控": 1250, "助播": 750 });
});

test("员工接口只返回本人店铺和个人提成，不泄露利润、团队提成或全库入口数据", async () => {
  const kdzs = { listAll: async (method, params) => {
    if (method === "kdzs.erp.api.trade.list") return [
      { sellerNick: "测试店", platform: "抖音", payment: 100, receivedPayment: 100 },
      { sellerNick: "其他店", platform: "抖音", payment: 200, receivedPayment: 200 },
    ];
    if (method === "kdzs.erp.api.refund.list") return [];
    if (params.queryGroupType === 8) return [
      { sellerNick: "测试店", platform: "抖音", itemTitle: "商品A", skuId: "sku-a", number: 1, payment: 100, netSalesProfit: 100 },
      { sellerNick: "其他店", platform: "抖音", itemTitle: "商品B", skuId: "sku-b", number: 1, payment: 200, netSalesProfit: 200 },
    ];
    return [{ sellerNick: "测试店", platform: "抖音", netSalesProfit: 100 }, { sellerNick: "其他店", platform: "抖音", netSalesProfit: 200 }];
  } };
  const service = new DashboardService({ feishu: fakeFeishu(), getKdzs: async () => kdzs, cacheSeconds: 15 });
  const dashboard = await service.getDashboard({ date: "2026-07-20", store: "其他店", viewer: { scope: "employee", name: "主播A", role: "主播", store: "测试店" } });
  assert.deepEqual(dashboard.filters.stores, ["测试店"]);
  assert.equal(dashboard.commissions.length, 1);
  assert.equal(dashboard.commissions[0].name, "主播A");
  assert.equal(Object.hasOwn(dashboard.summary, "profit"), false);
  assert.equal(dashboard.rules, null);
  assert.equal(dashboard.team.length, 0);
  assert.equal(dashboard.products.length, 1);
  assert.equal(dashboard.products[0].name, "商品A");
  assert.equal(Object.hasOwn(dashboard.products[0], "profit"), false);
  assert.equal(Object.hasOwn(dashboard.products[0], "teamCommission"), false);
  assert.equal(Object.hasOwn(dashboard.products[0], "roleCommission"), false);
});
