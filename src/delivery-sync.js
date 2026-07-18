import { addDays, dateChunks, dateOnly, endOfDayString, monthBounds, number, previousMonth, roundMoney, startOfDayString, text, uniqueBy } from "./utils.js";

// 客户交付库：只使用 Bvsz 内已有的业务表。LJB0 仅由 session-provider 读取 ERP 会话。
export const DELIVERY_TABLES = {
  storeProfit: { id: "tbl9gFmO5uMKICim", name: "02_店铺利润明细" },
  productProfit: { id: "tblYspPneEMahri9", name: "03_商品利润明细" },
  orders: { id: "tbl4bNkg9qYtHRnx", name: "06_订单列表" },
  refunds: { id: "tblF7SuQiYv4azWO", name: "07_售后列表" },
  stock: { id: "tblE8KiTH7i9Ztgi", name: "10_库存快照" },
  platformProducts: { id: "tbliWwmw0FyCofG8", name: "11_平台商品" },
  erpProducts: { id: "tblIy0rAsZe6Gzd4", name: "12_ERP货品" },
  people: { id: "tblk69nrryfyiy05", name: "13_人员表" },
  payroll: { id: "tblUmmf1ph2ri8TJ", name: "14_工资表" },
  rules: { id: "tbl6hPsnj4M7A4oz", name: "15_工资规则说明" },
};

const KEY = "同步唯一键";
const SYNC_TIME = "同步时间";

function scalar(value) {
  if (Array.isArray(value)) return value.map((item) => item?.text ?? item).join("");
  return value == null ? "" : String(value);
}

function dateMs(day) { return Date.parse(`${day}T00:00:00+08:00`); }
function monthOf(day) { return day.slice(0, 7); }
function halfOf(day) { return Number(day.slice(8, 10)) <= 14 ? "01-14" : "15-end"; }
function partitionName(prefix, day) { return `${prefix}_${monthOf(day)}_${halfOf(day)}`; }
function money(value) { return roundMoney(number(value)); }
function sameMonth(timestamp, month) {
  const { start, end } = monthBounds(month);
  return number(timestamp) >= start.getTime() && number(timestamp) <= end.getTime();
}

function mapStoreProfit(items, day) {
  return uniqueBy(items.map((item) => ({
    [KEY]: `${day}|${text(item.platform)}|${text(item.sellerNick)}`,
    "日期": dateMs(day), "店铺名称": text(item.sellerNick), "平台类型": text(item.platform),
    "利润": money(item.netSalesProfit), "利润率": number(item.netSalesProfitMargin) / 100,
    number: number(item.number), netSalesProfitMargin: number(item.netSalesProfitMargin), refundAmount: money(item.refundAmount),
    "销售成本": money(item.paymentCost),
    "销售毛利": money(item.paymentProfit), "销售毛利率": number(item.paymentProfitMargin) / 100,
    "实际收入": money(item.income), "运费成本": money(item.postCost), "邮费": money(item.postFee),
    "实发数量": number(item.actualNumber), "实发商品成本": money(item.actualCost ?? item.costPrice),
    "退款数量": number(item.refundNum ?? item.hasRefundNum), "退款金额": money(item.refundAmount), "退货成本": money(item.refundCost),
    "净销量": number(item.netSalesNum), "净销售额": money(item.netSales), "成本费用": money(item.netSalesCost) + money(item.postCost),
    "订单数": number(item.tidCount), "对应平台订单数量": number(item.ptTidCount),
    "发货前退货金额": money(item.beforeRefundAmount), "发货后退款金额": money(item.afterRefundAmount),
    "退货毛利": money(item.refundProfit), "实退数量": number(item.hasRefundNum),
    [SYNC_TIME]: Date.now(),
  })), (row) => row[KEY]);
}

function mapProductProfit(items, day) {
  return uniqueBy(items.map((item) => ({
    [KEY]: `${day}|${text(item.platform)}|${text(item.sellerNick)}|${text(item.tid)}|${text(item.orderId)}|${text(item.skuId)}`,
    "日期": dateMs(day), "商品名称": text(item.itemTitle), "商品编码": text(item.outerId), "SKU_ID": text(item.skuId),
    "平台类型": text(item.platform), "利润": money(item.netSalesProfit), "利润率": number(item.netSalesProfitMargin) / 100,
    "销售数量": number(item.number), "销售金额": money(item.payment), "销售成本": money(item.paymentCost),
    "销售毛利": money(item.paymentProfit), "销售毛利率": number(item.paymentProfitMargin) / 100,
    "实际收入": money(item.income), "运费成本": money(item.postCost), "邮费": money(item.postFee),
    "实发数量": number(item.actualNumber), "实发商品成本": money(item.actualCost), "实发金额": money(item.actualPayment),
    "退款数量": number(item.refundNum), "退款金额": money(item.refundAmount), "退货成本": money(item.refundCost),
    "净销量": number(item.netSalesNum), "净销售额": money(item.netSales), "实际货品成本": money(item.netSalesCost),
    "订单数": number(item.tidCount), "对应平台订单数量": number(item.ptTidCount), "实退数量": number(item.hasRefundNum),
    "退货毛利": money(item.refundProfit), "发货前退货金额": money(item.beforeRefundAmount), "发货后退款金额": money(item.afterRefundAmount),
    "平台折扣金额": money(item.platformDiscount), "成本费用": money(item.netSalesCost) + money(item.postCost),
    "商品数量": number(item.itemNum), "销售均价": money(item.paymentAverage), "是否组合": number(item.isCombination),
    [SYNC_TIME]: Date.now(),
  })), (row) => row[KEY]);
}

function mapOrders(trades) {
  const rows = [];
  for (const trade of trades) for (const item of trade.orderList || []) rows.push({
    [KEY]: `${text(trade.tid)}|${text(item.oid || item.ptOid)}`, "店铺名称": text(trade.sellerNick),
    "创建时间": text(trade.created), "退款状态": text(trade.refundStatus), "来源": text(trade.source), "平台订单号": text(trade.ptTid),
    receivedPayment: text(trade.receivedPayment), "收件城市": text(trade.receiverCity), "平台类型": text(trade.platform), tid: text(trade.tid),
    "发货时间": text(trade.sysShipTime), "卖家ID": text(trade.sellerId), "卖家标记": number(trade.sellerFlag), "收件区县": text(trade.receiverDistrict),
    "收件省份": text(trade.receiverState), "修改时间": text(trade.modified), "支付金额": money(trade.payment), "平台描述": text(trade.platformDesc),
    "订单状态": text(trade.status), "已收金额": money(trade.receivedPayment), "平台子订单号": text(item.ptOid), "商品ID": text(item.numiid),
    "系统商品ID": text(item.sysItemId), item_refundStatus: text(item.refundStatus), "系统SKU图片": text(item.sysSkuUrl), "子订单ID": text(item.oid),
    "商品名称": text(item.title), "SKU属性": text(item.skuProperties), "系统SKU_ID": text(item.sysSkuId), "数量": number(item.number),
    "系统SKU名称": text(item.sysSkuName), "SKU_ID": text(item.skuId), "子订单状态": text(item.status), "最后发货时间": text(trade.lastShipTime),
    "商品编码": text(item.outerId), item_skuOuterId: text(item.skuOuterId), "卖家备注": text(trade.sellerMemo), "买家留言": text(trade.buyerMessage),
    "SKU编码": text(item.skuOuterId), [SYNC_TIME]: Date.now(),
  });
  return uniqueBy(rows, (row) => row[KEY]);
}

function mapRefunds(refunds) {
  const rows = [];
  for (const refund of refunds) {
    const items = refund.items?.length ? refund.items : [{}];
    for (const item of items) rows.push({
      [KEY]: `${text(refund.refundId)}|${text(item.outerSkuId || item.skuId || "-")}|${text(item.title || "-")}`,
      "退款编号": text(refund.refundId), "订单编号": text(refund.tid), "平台订单号": text(refund.ptTid), "店铺ID": text(refund.sellerId),
      "店铺名称": text(refund.sellerNick), "平台类型": text(refund.platform), "退款状态": text(refund.refundStatus),
      "退款状态说明": text(refund.refundStatusDesc), "退款金额": money(refund.refundAmount), "买家申请时间": text(refund.refundCreatedTime),
      "售后更新时间": text(refund.refundModifiedTime), "售后类型": text(refund.afterSaleType), "售后原因": text(refund.refundReason),
      "货物状态": text(refund.goodsStatus), "货物状态说明": text(refund.goodsStatusDesc), "物流公司名称": text(refund.logisticsName),
      "退货物流单号": text(refund.returnLogisticsNo), "商品标题": text(item.title), "规格名称": text(item.skuProperties),
      "商家编码": text(item.outerId), "商家规格编码": text(item.outerSkuId), "售后数量": number(item.refundNum), "商品退款金额": money(item.refundAmount),
      [SYNC_TIME]: Date.now(),
    });
  }
  return uniqueBy(rows, (row) => row[KEY]);
}

function mapLogistics(items) {
  return uniqueBy(items.map((item) => ({
    [KEY]: `${text(item.tid)}|${text(item.ydNo)}`, "订单号": text(item.tid), "运单号": text(item.ydNo),
    "店铺名称": text(item.shopName), "平台类型": text(item.shopType || item.ptType), "快递公司编码": text(item.kdCode),
    "快递公司名称": text(item.exCodeName), "发货时间": text(item.sendTime), "最新物流时间": text(item.lastTime),
    "最新物流详情": text(item.lastDesc), "物流状态": text(item.logisticsYunStatusVal), "物流子状态": text(item.subLogisticsStatus),
    "异常状态": number(item.abnormalStatus), "处理状态": number(item.dealStatus), "退款状态类型": text(item.refundStatusType),
    "收货省": text(item.receiverProvince), "收货市": text(item.receiverCity), "收货区县": text(item.receiverCounty), [SYNC_TIME]: Date.now(),
  })), (row) => row[KEY]);
}

function mapStock(items) {
  return uniqueBy(items.map((item) => ({
    [KEY]: text(item.sysSkuId), "系统商品ID": text(item.sysItemId), "系统SKU_ID": text(item.sysSkuId), "商品名称": text(item.sysItemName),
    "SKU名称": text(item.sysSkuName), "SKU编码": text(item.skuOuterId), "商品编号": text(item.itemNo), "条形码": text(item.barCode),
    "总库存": number(item.stockTotal), "可配货库存": number(item.salableItemDistributableStock), "预占数量": number(item.salableItemPreemptedNum),
    "在途库存": number(item.transitItemStock), "退货待处理": number(item.refundStockWaitHandNum), [SYNC_TIME]: Date.now(),
  })), (row) => row[KEY]);
}

function mapPlatformProducts(items) {
  const rows = [];
  for (const item of items) for (const sku of item.platformItemSkuList || []) rows.push({
    [KEY]: `${text(item.numIid)}|${text(sku.skuId)}`, "商品ID": text(item.numIid), "商品标题": text(item.title), "审核状态": text(item.approveStatus),
    "SKU_ID": text(sku.skuId), "SKU名称": text(sku.skuName), "SKU编码": text(sku.skuOuterId), "SKU价格": money(sku.price),
    "SKU创建时间": text(sku.itemSkuCreateTime), "SKU图片": text(sku.skuPicUrl), "商品图片": text(item.itemPicUrl), "外部编码": text(item.outerId), [SYNC_TIME]: Date.now(),
  });
  return uniqueBy(rows, (row) => row[KEY]);
}

function mapErpProducts(items) {
  const rows = [];
  for (const item of items) for (const sku of item.skuList || []) rows.push({
    [KEY]: `${text(item.sysItemId)}|${text(sku.sysSkuId)}`, "系统商品ID": text(item.sysItemId), "商品名称": text(item.sysItemName),
    "商品编号": text(item.itemNo), "分类ID": text(item.classifyId), "分类名称": text(item.classifyName), "属性": text(item.property),
    "创建时间": text(item.created), "修改时间": text(item.modified), "系统SKU_ID": text(sku.sysSkuId), "SKU名称": text(sku.sysSkuName),
    "SKU编码": text(sku.skuOuterId), "SKU外部编码": text(sku.skuOuterId), "SKU创建时间": text(sku.created), "SKU修改时间": text(sku.modified),
    "成本价": money(sku.costPrice), "价格": money(sku.price), "重量": number(sku.weight), "条形码": text(sku.barCode), "货位": text(sku.warehouseSlotName),
    "颜色": text(sku.sysColor), "尺码": text(sku.sysSize), "外部编码": text(item.outerId), [SYNC_TIME]: Date.now(),
  });
  return uniqueBy(rows, (row) => row[KEY]);
}

export class DeliverySyncService {
  constructor({ feishu, kdzs, logger = console }) {
    this.feishu = feishu; this.kdzs = kdzs; this.logger = logger;
    this.tables = { ...DELIVERY_TABLES }; this.partitionCache = new Map();
  }

  async ensureSupportTables() {
    const logs = await this.feishu.ensureTable("16_同步日志", [
      { field_name: "任务键", type: 1 }, { field_name: "日期", type: 1 }, { field_name: "状态", type: 1 },
      { field_name: "订单数", type: 2 }, { field_name: "售后数", type: 2 }, { field_name: "店铺利润数", type: 2 },
      { field_name: "商品利润数", type: 2 }, { field_name: "失败原因", type: 1 }, { field_name: "完成时间", type: 5 },
    ]);
    const reconcile = await this.feishu.ensureTable("17_月度利润对账", [
      { field_name: "对账键", type: 1 }, { field_name: "月份", type: 1 }, { field_name: "店铺", type: 1 },
      { field_name: "ERP利润", type: 2 }, { field_name: "飞书利润", type: 2 }, { field_name: "差额", type: 2 },
      { field_name: "覆盖天数", type: 2 }, { field_name: "状态", type: 1 }, { field_name: "核对时间", type: 5 },
    ]);
    this.tables.logs = { id: logs.table_id, name: "16_同步日志" };
    this.tables.reconciliation = { id: reconcile.table_id, name: "17_月度利润对账" };
    await this.feishu.ensureField(this.tables.payroll.id, "工资唯一键", 1);
    return this.tables;
  }

  async upsert(table, rows, keyField = KEY) {
    if (!rows.length) return { total: 0, created: 0, updated: 0, failed: 0, failures: [] };
    return this.feishu.upsert(table.id, rows, { keyField, legacyKey: (fields) => scalar(fields[keyField]) });
  }

  async getPartition(prefix, day, rows) {
    const cacheKey = `${prefix}|${monthOf(day)}|${halfOf(day)}`;
    if (this.partitionCache.has(cacheKey)) return this.partitionCache.get(cacheKey);
    const name = partitionName(prefix, day);
    const fields = Object.entries(rows[0] || {}).map(([field_name, value]) => ({ field_name, type: typeof value === "number" ? 2 : 1 }));
    const table = await this.feishu.ensureTable(name, fields);
    for (const field of fields) await this.feishu.ensureField(table.table_id, field.field_name, field.type);
    const existing = await this.feishu.listRecords(table.table_id);
    const index = new Map(existing.map((record) => [scalar(record.fields?.[KEY]), record.record_id]).filter(([key]) => key));
    const value = { id: table.table_id, name, index, count: existing.length };
    this.partitionCache.set(cacheKey, value);
    return value;
  }

  async writePartition(prefix, day, rows) {
    if (!rows.length) return { total: 0, created: 0, updated: 0, failed: 0, failures: [] };
    const target = await this.getPartition(prefix, day, rows);
    const creates = []; const updates = [];
    for (const row of rows) {
      const recordId = target.index.get(scalar(row[KEY]));
      if (recordId) updates.push({ record_id: recordId, fields: row }); else creates.push(row);
    }
    if (target.count + creates.length > 19000) throw new Error(`${target.name}预计超过19000条，已停止写入，禁止产生超限表`);
    const created = creates.length ? await this.feishu.batchCreateSafe(target.id, creates) : { succeeded: [], failures: [] };
    const updated = updates.length ? await this.feishu.batchUpdateSafe(target.id, updates) : { succeeded: [], failures: [] };
    if (created.failures.length || updated.failures.length) throw new Error(`${target.name}写入失败：${created.failures[0]?.reason || updated.failures[0]?.reason}`);
    target.count += created.succeeded.length;
    return { total: rows.length, created: created.succeeded.length, updated: updated.succeeded.length, failed: 0, failures: [] };
  }

  async logDay(day, fields) {
    return this.upsert(this.tables.logs, [{ "任务键": `day|${day}`, "日期": day, "完成时间": Date.now(), ...fields }], "任务键");
  }

  async syncDay(day) {
    await this.ensureSupportTables();
    const range = { startTime: startOfDayString(new Date(`${day}T00:00:00+08:00`)), endTime: endOfDayString(new Date(`${day}T00:00:00+08:00`)) };
    try {
      const [trades, refunds, logistics, storeItems, productItems] = await Promise.all([
        this.kdzs.listAll("kdzs.erp.api.trade.list", { timeType: "CREATE_TIME", ...range }, 200),
        this.kdzs.listAll("kdzs.erp.api.refund.list", { createTimeStart: range.startTime, createTimeEnd: range.endTime }, 200),
        this.kdzs.listAll("kdzs.erp.api.report.logistics", { sendTimeStart: range.startTime, sendTimeEnd: range.endTime }, 200),
        this.kdzs.listAll("kdzs.erp.api.report.gross.profit", { queryTimeType: 3, queryGroupType: 2, ...range }),
        this.kdzs.listAll("kdzs.erp.api.report.gross.profit", { queryTimeType: 3, queryGroupType: 8, ...range }),
      ]);
      const result = {
        storeProfit: await this.upsert(this.tables.storeProfit, mapStoreProfit(storeItems, day)),
        productProfit: await this.writePartition("03_商品利润明细", day, mapProductProfit(productItems, day)),
        orders: await this.writePartition("06_订单列表", day, mapOrders(trades)),
        refunds: await this.writePartition("07_售后列表", day, mapRefunds(refunds)),
        logistics: await this.writePartition("08_物流列表", day, mapLogistics(logistics)),
      };
      for (const [dataType, write] of Object.entries(result)) {
        if (write.failed || write.created + write.updated !== write.total) {
          const reason = write.failures?.[0]?.reason || "未返回具体原因";
          throw new Error(`${day} ${dataType}写入不完整：成功${write.created + write.updated}/总计${write.total}，失败${write.failed}；${reason}`);
        }
      }
      await this.logDay(day, { "状态": "成功", "订单数": result.orders.total, "售后数": result.refunds.total, "店铺利润数": result.storeProfit.total, "商品利润数": result.productProfit.total });
      this.logger.info(JSON.stringify({ day, status: "success", ...Object.fromEntries(Object.entries(result).map(([key, value]) => [key, value.total])) }));
      return result;
    } catch (error) {
      await this.logDay(day, { "状态": "失败", "失败原因": error.message });
      throw error;
    }
  }

  async syncReferenceData() {
    await this.ensureSupportTables();
    const [stock, platformProducts, erpProducts] = await Promise.all([
      this.kdzs.listAll("kdzs.erp.api.stock.list"),
      this.kdzs.listAll("kdzs.erp.api.platform.item.list", { returnSku: true }),
      this.kdzs.listAll("kdzs.erp.api.sys.item.list", { needSkuDetail: true }),
    ]);
    return {
      stock: await this.upsert(this.tables.stock, mapStock(stock)),
      platformProducts: await this.upsert(this.tables.platformProducts, mapPlatformProducts(platformProducts)),
      erpProducts: await this.upsert(this.tables.erpProducts, mapErpProducts(erpProducts)),
    };
  }

  async backfill({ startDate, endDate }) {
    const start = new Date(`${startDate}T00:00:00+08:00`); const end = new Date(`${endDate}T23:59:59+08:00`);
    const days = [];
    for (const [day] of dateChunks(start, end, 1)) days.push({ day: dateOnly(day), ...(await this.syncDay(dateOnly(day))) });
    return { startDate, endDate, days };
  }

  async syncLogisticsDay(day) {
    const date = new Date(`${day}T00:00:00+08:00`);
    const rows = await this.kdzs.listAll("kdzs.erp.api.report.logistics", {
      sendTimeStart: startOfDayString(date), sendTimeEnd: endOfDayString(date),
    }, 200);
    return this.writePartition("08_物流列表", day, mapLogistics(rows));
  }

  async backfillLogistics({ startDate, endDate }) {
    const start = new Date(`${startDate}T00:00:00+08:00`); const end = new Date(`${endDate}T23:59:59+08:00`); const days = [];
    for (const [day] of dateChunks(start, end, 1)) {
      const dayText = dateOnly(day); days.push({ day: dayText, ...(await this.syncLogisticsDay(dayText)) });
    }
    return { startDate, endDate, days };
  }

  async reconcileMonth(month) {
    await this.ensureSupportTables();
    const { start, end } = monthBounds(month);
    const [profitRecords, logs] = await Promise.all([this.feishu.listRecords(this.tables.storeProfit.id), this.feishu.listRecords(this.tables.logs.id)]);
    const feishu = new Map(); const erp = new Map(); const completedDays = new Set();
    for (const record of logs) if (scalar(record.fields?.["状态"]) === "成功" && scalar(record.fields?.["日期"]).startsWith(month)) completedDays.add(scalar(record.fields?.["日期"]));
    for (const record of profitRecords) {
      const fields = record.fields || {}; if (!sameMonth(fields["日期"], month)) continue;
      const key = scalar(fields["店铺名称"]); feishu.set(key, money(feishu.get(key)) + money(fields["利润"]));
    }
    for (const [date] of dateChunks(start, end, 1)) {
      const day = dateOnly(date); const range = { queryTimeType: 3, queryGroupType: 2, startTime: startOfDayString(date), endTime: endOfDayString(date) };
      const rows = await this.kdzs.listAll("kdzs.erp.api.report.gross.profit", range);
      for (const row of rows) { const store = text(row.sellerNick); erp.set(store, money(erp.get(store)) + money(row.netSalesProfit)); }
      if (!completedDays.has(day)) throw new Error(`${day}未完成同步，禁止月度结算`);
    }
    const stores = new Set([...erp.keys(), ...feishu.keys()]); const rows = [];
    for (const store of stores) {
      const erpProfit = money(erp.get(store)); const feishuProfit = money(feishu.get(store)); const diff = money(erpProfit - feishuProfit);
      rows.push({ "对账键": `${month}|${store}`, "月份": month, "店铺": store, "ERP利润": erpProfit, "飞书利润": feishuProfit,
        "差额": diff, "覆盖天数": completedDays.size, "状态": Math.abs(diff) <= 0.01 ? "通过" : "不通过", "核对时间": Date.now() });
    }
    await this.upsert(this.tables.reconciliation, rows, "对账键");
    return { month, rows, passed: rows.length > 0 && rows.every((row) => row["状态"] === "通过") };
  }

  async preparePayroll(month) {
    await this.ensureSupportTables();
    const [people, payroll] = await Promise.all([this.feishu.listRecords(this.tables.people.id), this.feishu.listRecords(this.tables.payroll.id)]);
    const existing = new Map(payroll.map((record) => [scalar(record.fields?.["工资唯一键"]), record])); const creates = [];
    for (const record of people) {
      const fields = record.fields || {}; const name = scalar(fields["姓名"]); const store = scalar(fields["所属店铺"]);
      if (!name || !store || !Number.isFinite(number(fields["基本工资"])) || !Number.isFinite(number(fields["提成百分比"]))) continue;
      const key = `${month}|${name}`; if (existing.has(key)) continue;
      creates.push({ "姓名": name, "月份": monthBounds(month).start.getTime(), "绩效工资": 0, "奖金": 0, "扣款": 0, "结算状态": "待结算", "工资唯一键": key });
    }
    if (creates.length) await this.feishu.batchCreate(this.tables.payroll.id, creates);
    return { month, created: creates.length };
  }

  async settlePayroll(month = previousMonth(new Date())) {
    const reconciliation = await this.reconcileMonth(month);
    if (!reconciliation.passed) throw new Error(`${month}利润对账未通过，禁止工资结算`);
    const records = await this.feishu.listRecords(this.tables.payroll.id); const updates = [];
    for (const record of records) {
      const fields = record.fields || {}; if (!sameMonth(fields["月份"], month) || scalar(fields["结算状态"]) === "已结算") continue;
      const payable = money(fields["应发工资"]); const profit = money(fields["所在店铺当月利润和"]); const rate = number(fields["提成百分比"]);
      updates.push({ record_id: record.record_id, fields: { "实发工资": payable, "店铺利润快照": profit, "提成金额快照": money(Math.max(0, profit) * rate), "结算状态": "已结算", "结算时间": Date.now() } });
    }
    if (updates.length) await this.feishu.batchUpdate(this.tables.payroll.id, updates);
    return { month, settled: updates.length };
  }
}
