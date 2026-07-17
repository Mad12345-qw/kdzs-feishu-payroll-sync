import { NEW_TABLES } from "./new-base-tables.js";
import {
  mapCuratedStoreProfit, mapNewErpProducts, mapNewErpSkus, mapNewOrderItems, mapNewOrders,
  mapNewPlatformProducts, mapNewPlatformSkus, mapNewRefundItems, mapNewRefunds, mapNewStock, mapNewStoreProfit,
} from "./new-base-mappings.js";
import { addDays, dateChunks, dateOnly, endOfDayString, monthBounds, previousMonth, startOfDayString } from "./utils.js";

const SYNC_TIME = "同步时间";

export class NewBaseSyncService {
  constructor({ feishu, kdzs, config, logger = console }) {
    this.feishu = feishu; this.kdzs = kdzs; this.config = config; this.logger = logger;
    this.tables = { ...NEW_TABLES };
  }

  async migrate() {
    const refunds = await this.feishu.ensureTable("售后表", [
      { field_name: "退款编号", type: 1 }, { field_name: "系统订单号", type: 1 }, { field_name: "平台订单号", type: 1 },
      { field_name: "店铺名称", type: 1 }, { field_name: "店铺ID", type: 1 }, { field_name: "平台", type: 1 },
      { field_name: "售后类型", type: 1 }, { field_name: "退款状态", type: 1 }, { field_name: "退款状态说明", type: 1 },
      { field_name: "货物状态", type: 1 }, { field_name: "货物状态说明", type: 1 }, { field_name: "退款原因", type: 1 },
      { field_name: "退款金额", type: 2 }, { field_name: "创建时间", type: 1 }, { field_name: "修改时间", type: 1 },
      { field_name: "物流公司", type: 1 }, { field_name: "退货单号", type: 1 },
    ]);
    const refundItems = await this.feishu.ensureTable("售后明细表", [
      { field_name: "退款编号", type: 1 }, { field_name: "商品标题", type: 1 }, { field_name: "规格名称", type: 1 },
      { field_name: "商家编码", type: 1 }, { field_name: "规格编码", type: 1 }, { field_name: "退款数量", type: 2 },
      { field_name: "退款金额", type: 2 },
    ]);
    this.tables.refunds = { name: "售后表", id: refunds.table_id };
    this.tables.refundItems = { name: "售后明细表", id: refundItems.table_id };
    const people = await this.feishu.ensureTable("人员配置表", [
      { field_name: "姓名", type: 1 }, { field_name: "部门", type: 1 }, { field_name: "所属店铺", type: 1 },
      { field_name: "基本工资", type: 2 }, { field_name: "提成百分比", type: 2 }, { field_name: "在职状态", type: 1 },
    ]);
    const payroll = await this.feishu.ensureTable("工资结算表", [
      { field_name: "员工月份", type: 1 }, { field_name: "月份", type: 5 }, { field_name: "姓名", type: 1 },
      { field_name: "店铺", type: 1 }, { field_name: "基本工资", type: 2 }, { field_name: "提成比例", type: 2 },
      { field_name: "店铺利润", type: 2 }, { field_name: "绩效工资", type: 2 }, { field_name: "奖金", type: 2 },
      { field_name: "扣款", type: 2 }, { field_name: "提成金额", type: 2 }, { field_name: "应发工资", type: 2 },
      { field_name: "实发工资", type: 2 }, { field_name: "结算状态", type: 1 }, { field_name: "结算时间", type: 5 },
      { field_name: "备注", type: 1 },
    ]);
    const rules = await this.feishu.ensureTable("工资规则说明", [
      { field_name: "规则项", type: 1 }, { field_name: "当前规则", type: 1 }, { field_name: "客户维护说明", type: 1 },
    ]);
    this.tables.people = { name: "人员配置表", id: people.table_id };
    this.tables.payrollSettlement = { name: "工资结算表", id: payroll.table_id };
    this.tables.payrollRules = { name: "工资规则说明", id: rules.table_id };
    for (const table of Object.values(this.tables).filter((table) => table?.id && table.id !== NEW_TABLES.session.id)) {
      await this.feishu.ensureField(table.id, "同步唯一键", 1);
      await this.feishu.ensureField(table.id, SYNC_TIME, 5, { date_formatter: "yyyy/MM/dd HH:mm" });
    }
    await this.feishu.ensureField(NEW_TABLES.orderItems.id, "tid", 1);
    await this.feishu.ensureField(NEW_TABLES.orderItems.id, "ptTid", 1);
    await this.feishu.ensureField(NEW_TABLES.platformSkus.id, "商品id", 1);
    await this.feishu.ensureField(NEW_TABLES.erpSkus.id, "ERP商品ID", 1);
    const existingRules = await this.feishu.listRecords(this.tables.payrollRules.id);
    if (!existingRules.length) await this.feishu.batchCreate(this.tables.payrollRules.id, [
      { "规则项": "人员与店铺", "当前规则": "人员配置表每一行是独立工资对象，同店铺多人分别按各自比例计算。", "客户维护说明": "维护姓名、所属店铺、基本工资和提成比例。" },
      { "规则项": "利润基数", "当前规则": "默认采用ERP返回的最终店铺净利润netSalesProfit。", "客户维护说明": "无需手工计算利润。" },
      { "规则项": "负利润", "当前规则": "店铺利润小于0时，提成按0计算。", "客户维护说明": "无需操作。" },
      { "规则项": "工资公式", "当前规则": "底薪+绩效+奖金+MAX(0,店铺利润)×提成比例-扣款。", "客户维护说明": "只填绩效、奖金和扣款。" },
      { "规则项": "结算时间", "当前规则": "每月15日结算上月工资。", "客户维护说明": "特殊日期在结算前调整。" },
      { "规则项": "金额精度", "当前规则": "所有金额四舍五入保留2位。", "客户维护说明": "无需操作。" },
      { "规则项": "月度人工项", "当前规则": "绩效、奖金、扣款未填写按0。", "客户维护说明": "在工资结算表维护。" },
      { "规则项": "历史结果", "当前规则": "结算后固化底薪、比例、利润、提成和工资快照。", "客户维护说明": "已结算结果不自动变化。" },
    ]);
    return this.tables;
  }

  stamp(rows) { const now = Date.now(); return rows.map((row) => ({ ...row, [SYNC_TIME]: now })); }

  async upsert(table, rows, legacyKey) {
    return this.feishu.upsert(table.id, this.stamp(rows), { legacyKey });
  }

  async syncOperational({ lookbackDays = 3, refundLookbackDays = 3 } = {}) {
    await this.migrate();
    const now = new Date(); const start = addDays(now, -(lookbackDays - 1));
    const trades = [];
    for (const [from, to] of dateChunks(start, now, 29)) trades.push(...await this.kdzs.listAll("kdzs.erp.api.trade.list", {
      timeType: "CREATE_TIME", startTime: startOfDayString(from), endTime: endOfDayString(to),
    }, 100));
    const refunds = await this.kdzs.listAll("kdzs.erp.api.refund.list", {
      modifiedTimeStart: startOfDayString(addDays(now, -(refundLookbackDays - 1))), modifiedTimeEnd: endOfDayString(now),
    });
    const stock = await this.kdzs.listAll("kdzs.erp.api.stock.list");
    return {
      orders: await this.upsert(this.tables.orders, mapNewOrders(trades), (f) => f.tid || f["文本"]),
      orderItems: await this.upsert(this.tables.orderItems, mapNewOrderItems(trades), (f) => f["同步唯一键"] || f["文本"]),
      refunds: await this.upsert(this.tables.refunds, mapNewRefunds(refunds), (f) => f["退款编号"]),
      refundItems: await this.upsert(this.tables.refundItems, mapNewRefundItems(refunds), (f) => f["同步唯一键"]),
      stock: await this.upsert(this.tables.stock, mapNewStock(stock), (f) => f["货品规格ID"]),
    };
  }

  async syncDaily({ profitLookbackDays = 45 } = {}) {
    await this.migrate();
    const platformItems = await this.kdzs.listAll("kdzs.erp.api.platform.item.list", { returnSku: true });
    const erpItems = await this.kdzs.listAll("kdzs.erp.api.sys.item.list", { needSkuDetail: true });
    const results = {
      platformProducts: await this.upsert(this.tables.platformProducts, mapNewPlatformProducts(platformItems), (f) => f["商品id"]),
      platformSkus: await this.upsert(this.tables.platformSkus, mapNewPlatformSkus(platformItems), (f) => f["同步唯一键"]),
      erpProducts: await this.upsert(this.tables.erpProducts, mapNewErpProducts(erpItems), (f) => String(f.sysItemId || "")),
      erpSkus: await this.upsert(this.tables.erpSkus, mapNewErpSkus(erpItems), (f) => f["同步唯一键"]),
    };
    results.profit = await this.syncProfit({ profitLookbackDays, skipMigrate: true });
    return results;
  }

  async syncProfit({ profitLookbackDays = 45, skipMigrate = false } = {}) {
    if (!skipMigrate) await this.migrate();
    const now = new Date();
    const rollingStart = addDays(now, -(profitLookbackDays - 1));
    const previousStart = monthBounds(previousMonth(now)).start;
    const start = rollingStart < previousStart ? rollingStart : previousStart;
    const raw = []; const curated = [];
    for (const [day] of dateChunks(start, now, 1)) {
      const items = await this.kdzs.listAll("kdzs.erp.api.report.gross.profit", {
        queryTimeType: 3, queryGroupType: 2, startTime: startOfDayString(day), endTime: endOfDayString(day),
      });
      raw.push(...mapNewStoreProfit(items, dateOnly(day)));
      curated.push(...mapCuratedStoreProfit(items, dateOnly(day)));
    }
    return {
      profitRaw: await this.upsert(this.tables.profitRaw, raw, (f) => f["同步唯一键"] || f["文本"]),
      storeProfit: await this.upsert(this.tables.storeProfit, curated, (f) => f["同步唯一键"]),
    };
  }
}
