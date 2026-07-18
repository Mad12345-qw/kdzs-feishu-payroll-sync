import { NEW_TABLES } from "./new-base-tables.js";
import {
  mapCuratedStoreProfit, mapLogistics, mapNewErpProducts, mapNewErpSkus, mapNewOrderItems, mapNewOrders,
  mapNewPlatformProducts, mapNewPlatformSkus, mapNewRefundItems, mapNewRefunds, mapNewStock, mapNewStoreProfit,
  mapOrderProfit, mapProductProfit, mapPurchases, mapStockIn,
} from "./new-base-mappings.js";
import { addDays, dateChunks, dateOnly, endOfDayString, monthBounds, number, previousMonth, roundMoney, startOfDayString } from "./utils.js";

const SYNC_TIME = "同步时间";

function fieldText(value) {
  if (Array.isArray(value)) return value.map((item) => item?.text ?? item).join("");
  return value == null ? "" : String(value);
}

function collectStats(input, path = "") {
  const stats = { total: 0, created: 0, updated: 0, failed: 0, failures: [] };
  const visit = (value, currentPath) => {
    if (!value || typeof value !== "object") return;
    if (["total", "created", "updated", "failed"].some((key) => Object.hasOwn(value, key))) {
      stats.total += number(value.total); stats.created += number(value.created); stats.updated += number(value.updated);
      stats.failed += number(value.failed);
      for (const failure of value.failures || []) stats.failures.push({ dataType: currentPath, ...failure });
      return;
    }
    for (const [key, child] of Object.entries(value)) visit(child, currentPath ? `${currentPath}.${key}` : key);
  };
  visit(input, path);
  return stats;
}

function daysInMonth(month) {
  const { start, end } = monthBounds(month);
  return Math.round((end.getTime() - start.getTime() + 1000) / 86400000);
}

function archivePeriod(dateText) {
  const [year, month, day] = dateText.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day <= 14 ? `${year}-${String(month).padStart(2, "0")}-01_14` : `${year}-${String(month).padStart(2, "0")}-15_${lastDay}`;
}

function halfMonthRanges(start, end) {
  const ranges = []; let cursor = new Date(start);
  while (cursor <= end) {
    const text = dateOnly(cursor); const [year, month, day] = text.split("-").map(Number);
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const periodEndDay = day <= 14 ? 14 : lastDay;
    const periodEnd = new Date(`${year}-${String(month).padStart(2, "0")}-${String(periodEndDay).padStart(2, "0")}T23:59:59+08:00`);
    const clipped = periodEnd > end ? new Date(end) : periodEnd;
    ranges.push([new Date(cursor), clipped, archivePeriod(text)]);
    cursor = addDays(new Date(`${dateOnly(clipped)}T00:00:00+08:00`), 1);
  }
  return ranges;
}

function partitionDate(value) {
  const date = fieldText(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : "";
}

function monthPartition(value) {
  return partitionDate(value).slice(0, 7);
}

function halfMonthPartition(value) {
  const date = partitionDate(value);
  return Number(date.slice(8, 10)) <= 14 ? "01_14" : "15_31";
}

export class NewBaseSyncService {
  static cachedTables = null;

  constructor({ feishu, kdzs, config, logger = console }) {
    this.feishu = feishu; this.kdzs = kdzs; this.config = config; this.logger = logger;
    this.tables = { ...NEW_TABLES };
  }

  async migrate() {
    if (NewBaseSyncService.cachedTables) {
      this.tables = { ...NewBaseSyncService.cachedTables };
      return this.tables;
    }
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
      { field_name: "参与工资结算", type: 1 },
    ]);
    const payroll = await this.feishu.ensureTable("工资结算表", [
      { field_name: "员工月份", type: 1 }, { field_name: "月份", type: 5 }, { field_name: "姓名", type: 1 },
      { field_name: "店铺", type: 1 }, { field_name: "参与结算", type: 1 }, { field_name: "基本工资", type: 2 }, { field_name: "提成比例", type: 2 },
      { field_name: "店铺利润", type: 2 }, { field_name: "绩效工资", type: 2 }, { field_name: "奖金", type: 2 },
      { field_name: "扣款", type: 2 }, { field_name: "提成金额", type: 2 }, { field_name: "应发工资", type: 2 },
      { field_name: "实发工资", type: 2 }, { field_name: "结算状态", type: 1 }, { field_name: "结算时间", type: 5 },
      { field_name: "备注", type: 1 },
    ]);
    const rules = await this.feishu.ensureTable("工资规则说明", [
      { field_name: "规则项", type: 1 }, { field_name: "当前规则", type: 1 }, { field_name: "客户维护说明", type: 1 },
    ]);
    const logistics = await this.feishu.ensureTable("物流明细表", [
      { field_name: "订单号", type: 1 }, { field_name: "运单号", type: 1 }, { field_name: "店铺名称", type: 1 },
      { field_name: "平台", type: 1 }, { field_name: "快递公司编码", type: 1 }, { field_name: "快递模板名称", type: 1 },
      { field_name: "发货时间", type: 1 }, { field_name: "最新物流时间", type: 1 }, { field_name: "最新物流详情", type: 1 },
      { field_name: "物流状态", type: 1 }, { field_name: "物流子状态", type: 1 }, { field_name: "异常状态", type: 2 },
      { field_name: "处理状态", type: 2 }, { field_name: "退款状态类型", type: 1 }, { field_name: "收货省", type: 1 },
      { field_name: "收货市", type: 1 }, { field_name: "收货区县", type: 1 },
    ]);
    const stockIn = await this.feishu.ensureTable("库存入库表", [
      { field_name: "入库单号", type: 1 }, { field_name: "供应商", type: 1 }, { field_name: "创建时间", type: 1 },
      { field_name: "入库状态", type: 2 }, { field_name: "入库人", type: 1 }, { field_name: "入库备注", type: 1 },
      { field_name: "总入库数量", type: 2 }, { field_name: "总成本金额", type: 2 }, { field_name: "运费", type: 2 },
      { field_name: "其他费用", type: 2 }, { field_name: "货品简称", type: 1 }, { field_name: "SKU编码", type: 1 },
      { field_name: "入库数量", type: 2 }, { field_name: "单价", type: 2 }, { field_name: "成本价", type: 2 },
      { field_name: "明细备注", type: 1 }, { field_name: "图片", type: 1 },
    ]);
    const purchases = await this.feishu.ensureTable("采购单表", [
      { field_name: "采购单号", type: 1 }, { field_name: "采购单名称", type: 1 }, { field_name: "供应商", type: 1 },
      { field_name: "采购状态", type: 2 }, { field_name: "采购总数量", type: 2 }, { field_name: "采购总金额", type: 2 },
      { field_name: "采购运费", type: 2 }, { field_name: "其他费用", type: 2 }, { field_name: "创建时间", type: 1 },
      { field_name: "创建人", type: 1 }, { field_name: "采购备注", type: 1 }, { field_name: "系统商品ID", type: 1 },
      { field_name: "系统SKUID", type: 1 }, { field_name: "货品名称", type: 1 }, { field_name: "货品简称", type: 1 },
      { field_name: "SKU名称", type: 1 }, { field_name: "SKU别名", type: 1 }, { field_name: "SKU编码", type: 1 },
      { field_name: "商品编码", type: 1 }, { field_name: "采购数量", type: 2 }, { field_name: "已入库数量", type: 2 },
      { field_name: "成本价", type: 2 }, { field_name: "金额小计", type: 2 }, { field_name: "明细备注", type: 1 },
      { field_name: "图片", type: 1 },
    ]);
    const performance = await this.feishu.ensureTable("主播绩效表", [
      { field_name: "员工月份", type: 1 }, { field_name: "月份", type: 1 }, { field_name: "姓名", type: 1 },
      { field_name: "店铺", type: 1 }, { field_name: "GMV", type: 2 }, { field_name: "退款金额", type: 2 },
      { field_name: "实收金额", type: 2 }, { field_name: "商品成本", type: 2 }, { field_name: "运费", type: 2 },
      { field_name: "毛利", type: 2 }, { field_name: "净利润", type: 2 }, { field_name: "利润率", type: 2 },
      { field_name: "提成比例", type: 2 }, { field_name: "提成金额", type: 2 }, { field_name: "底薪", type: 2 },
      { field_name: "绩效工资", type: 2 }, { field_name: "奖金", type: 2 }, { field_name: "扣款", type: 2 },
      { field_name: "应发工资", type: 2 }, { field_name: "状态", type: 1 },
    ]);
    const syncLogs = await this.feishu.ensureTable("系统同步日志", [
      { field_name: "任务编号", type: 1 }, { field_name: "任务类型", type: 1 }, { field_name: "业务日期", type: 1 },
      { field_name: "开始时间", type: 5 }, { field_name: "结束时间", type: 5 }, { field_name: "状态", type: 1 },
      { field_name: "总条数", type: 2 }, { field_name: "新增条数", type: 2 }, { field_name: "更新条数", type: 2 },
      { field_name: "失败条数", type: 2 }, { field_name: "失败原因", type: 1 }, { field_name: "详情", type: 1 },
    ]);
    const exceptions = await this.feishu.ensureTable("系统数据异常", [
      { field_name: "任务编号", type: 1 }, { field_name: "任务类型", type: 1 }, { field_name: "数据类型", type: 1 },
      { field_name: "业务键", type: 1 }, { field_name: "操作", type: 1 }, { field_name: "异常原因", type: 1 },
      { field_name: "处理状态", type: 1 },
    ]);
    const reconciliation = await this.feishu.ensureTable("月度利润对账", [
      { field_name: "月份", type: 1 }, { field_name: "店铺", type: 1 }, { field_name: "ERP利润", type: 2 },
      { field_name: "飞书利润", type: 2 }, { field_name: "差额", type: 2 }, { field_name: "覆盖天数", type: 2 },
      { field_name: "应覆盖天数", type: 2 }, { field_name: "对账状态", type: 1 }, { field_name: "核对时间", type: 5 },
    ]);
    const batches = await this.feishu.ensureTable("工资结算批次", [
      { field_name: "批次编号", type: 1 }, { field_name: "月份", type: 1 }, { field_name: "结算日", type: 5 },
      { field_name: "状态", type: 1 }, { field_name: "员工数", type: 2 }, { field_name: "工资合计", type: 2 },
      { field_name: "对账结果", type: 1 }, { field_name: "阻断原因", type: 1 },
    ]);
    this.tables.people = { name: "人员配置表", id: people.table_id };
    this.tables.payrollSettlement = { name: "工资结算表", id: payroll.table_id };
    this.tables.payrollRules = { name: "工资规则说明", id: rules.table_id };
    this.tables.logistics = { name: "物流明细表", id: logistics.table_id };
    this.tables.stockIn = { name: "库存入库表", id: stockIn.table_id };
    this.tables.purchases = { name: "采购单表", id: purchases.table_id };
    this.tables.performance = { name: "主播绩效表", id: performance.table_id };
    this.tables.syncLogs = { name: "系统同步日志", id: syncLogs.table_id };
    this.tables.exceptions = { name: "系统数据异常", id: exceptions.table_id };
    this.tables.reconciliation = { name: "月度利润对账", id: reconciliation.table_id };
    this.tables.batches = { name: "工资结算批次", id: batches.table_id };
    for (const table of Object.values(this.tables).filter((table) => table?.id && table.id !== NEW_TABLES.session.id)) {
      await this.feishu.ensureField(table.id, "同步唯一键", 1);
      await this.feishu.ensureField(table.id, SYNC_TIME, 5, { date_formatter: "yyyy/MM/dd HH:mm" });
    }
    await this.feishu.ensureField(NEW_TABLES.orderItems.id, "tid", 1);
    await this.feishu.ensureField(NEW_TABLES.orderItems.id, "ptTid", 1);
    await this.feishu.ensureField(NEW_TABLES.platformSkus.id, "商品id", 1);
    await this.feishu.ensureField(NEW_TABLES.erpSkus.id, "ERP商品ID", 1);
    await this.feishu.ensureField(this.tables.people.id, "参与工资结算", 1);
    await this.feishu.ensureField(this.tables.payrollSettlement.id, "参与结算", 1);
    const existingRules = await this.feishu.listRecords(this.tables.payrollRules.id);
    const defaultRules = [
      { "规则项": "人员与店铺", "当前规则": "人员配置表每一行是独立工资对象，同店铺多人分别按各自比例计算。", "客户维护说明": "维护姓名、所属店铺、基本工资和提成比例。" },
      { "规则项": "利润基数", "当前规则": "默认采用ERP返回的最终店铺净利润netSalesProfit。", "客户维护说明": "无需手工计算利润。" },
      { "规则项": "负利润", "当前规则": "店铺利润小于0时，提成按0计算。", "客户维护说明": "无需操作。" },
      { "规则项": "工资公式", "当前规则": "底薪+绩效+奖金+MAX(0,店铺利润)×提成比例-扣款。", "客户维护说明": "只填绩效、奖金和扣款。" },
      { "规则项": "结算时间", "当前规则": "每月15日结算上月工资。", "客户维护说明": "特殊日期在结算前调整。" },
      { "规则项": "金额精度", "当前规则": "所有金额四舍五入保留2位。", "客户维护说明": "无需操作。" },
      { "规则项": "月度人工项", "当前规则": "绩效、奖金、扣款未填写按0。", "客户维护说明": "在工资结算表维护。" },
      { "规则项": "历史结果", "当前规则": "结算后固化底薪、比例、利润、提成和工资快照。", "客户维护说明": "已结算结果不自动变化。" },
      { "规则项": "结算范围", "当前规则": "人员配置表中姓名、所属店铺、基本工资和提成百分比齐全的在职人员自动参与结算。", "客户维护说明": "新增、删除或调整人员行后，待结算工资会自动刷新；无需填写额外开关。" },
      { "规则项": "结算闸门", "当前规则": "存在写入失败、利润日覆盖不完整或ERP与飞书差额超过0.01时禁止结算。", "客户维护说明": "处理系统数据异常后重新同步。" },
    ];
    const existingRuleNames = new Set(existingRules.map((record) => fieldText(record.fields?.["规则项"])));
    const missingRules = defaultRules.filter((row) => !existingRuleNames.has(row["规则项"]));
    if (missingRules.length) await this.feishu.batchCreate(this.tables.payrollRules.id, missingRules);
    const settlementRule = defaultRules.find((row) => row["规则项"] === "结算范围");
    const currentSettlementRule = existingRules.find((record) => fieldText(record.fields?.["规则项"]) === "结算范围");
    if (settlementRule && currentSettlementRule && (
      fieldText(currentSettlementRule.fields?.["当前规则"]) !== settlementRule["当前规则"]
      || fieldText(currentSettlementRule.fields?.["客户维护说明"]) !== settlementRule["客户维护说明"]
    )) {
      await this.feishu.batchUpdate(this.tables.payrollRules.id, [{ record_id: currentSettlementRule.record_id, fields: settlementRule }]);
    }
    NewBaseSyncService.cachedTables = { ...this.tables };
    return this.tables;
  }

  stamp(rows) { const now = Date.now(); return rows.map((row) => ({ ...row, [SYNC_TIME]: now })); }

  async upsert(table, rows, legacyKey, options = {}) {
    return this.feishu.upsert(table.id, this.stamp(rows), { legacyKey, ...options });
  }

  async ensurePartitionTable(name, rows) {
    const sample = rows[0];
    const fieldNames = ["同步唯一键", ...Object.keys(sample).filter((key) => key !== "同步唯一键" && key !== SYNC_TIME)];
    const table = await this.feishu.ensureTable(name, fieldNames.map((fieldName) => ({
      field_name: fieldName, type: typeof sample[fieldName] === "number" ? 2 : 1,
    })));
    await this.feishu.ensureField(table.table_id, "同步唯一键", 1);
    await this.feishu.ensureField(table.table_id, SYNC_TIME, 5, { date_formatter: "yyyy/MM/dd HH:mm" });
    return { name, id: table.table_id };
  }

  async writeOperationalPartition(name, rows, { maxRecords = 15000 } = {}) {
    if (!rows.length) return { total: 0, created: 0, updated: 0, failed: 0, failures: [], overLimit: false, existingRows: [], newRows: [] };
    const table = await this.ensurePartitionTable(name, rows);
    const existing = await this.feishu.listRecords(table.id);
    const existingKeys = new Set(existing.map((record) => fieldText(record.fields?.["同步唯一键"])).filter(Boolean));
    const existingRows = rows.filter((row) => existingKeys.has(fieldText(row["同步唯一键"])));
    const newRows = rows.filter((row) => !existingKeys.has(fieldText(row["同步唯一键"])));
    if (existing.length + newRows.length > maxRecords) {
      return { total: rows.length, created: 0, updated: 0, failed: 0, failures: [], overLimit: true, existingRows, newRows };
    }
    const write = await this.feishu.upsert(table.id, this.stamp(rows), { legacyKey: (fields) => fields["同步唯一键"] });
    return { ...write, overLimit: false, existingRows: [], newRows: [] };
  }

  async upsertOperationalPartitions(prefix, rows, dateField) {
    const grouped = new Map();
    for (const row of rows) {
      const month = monthPartition(row[dateField]);
      if (!month) throw new Error(`${prefix}缺少有效日期字段：${dateField}`);
      if (!grouped.has(month)) grouped.set(month, []);
      grouped.get(month).push(row);
    }
    const results = [];
    for (const [month, monthlyRows] of grouped) {
      const monthly = await this.writeOperationalPartition(`${prefix}_${month}`, monthlyRows);
      if (!monthly.overLimit) {
        results.push({ partition: month, ...monthly });
        continue;
      }
      if (monthly.existingRows.length) {
        const updates = await this.writeOperationalPartition(`${prefix}_${month}`, monthly.existingRows);
        if (updates.overLimit || updates.failed) throw new Error(`${prefix}_${month}已有记录更新失败`);
        results.push({ partition: month, ...updates });
      }
      const halves = new Map();
      for (const row of monthly.newRows) {
        const half = halfMonthPartition(row[dateField]);
        if (!halves.has(half)) halves.set(half, []);
        halves.get(half).push(row);
      }
      for (const [half, halfRows] of halves) {
        const split = await this.writeOperationalPartition(`${prefix}_${month}_${half}`, halfRows);
        if (!split.overLimit) {
          results.push({ partition: `${month}_${half}`, ...split });
          continue;
        }
        if (split.existingRows.length) {
          const updates = await this.writeOperationalPartition(`${prefix}_${month}_${half}`, split.existingRows);
          if (updates.overLimit || updates.failed) throw new Error(`${prefix}_${month}_${half}已有记录更新失败`);
          results.push({ partition: `${month}_${half}`, ...updates });
        }
        const days = new Map();
        for (const row of split.newRows) {
          const day = partitionDate(row[dateField]);
          if (!days.has(day)) days.set(day, []);
          days.get(day).push(row);
        }
        for (const [day, dayRows] of days) {
          const daily = await this.writeOperationalPartition(`${prefix}_${day}`, dayRows);
          if (daily.overLimit) throw new Error(`${prefix}_${day}超过15000条安全阈值，需要进一步按店铺拆分`);
          results.push({ partition: day, ...daily });
        }
      }
    }
    return { partitions: results };
  }

  async writeSyncLog(fields) {
    try {
      return await this.upsert(this.tables.syncLogs, [{
        "同步唯一键": fields["任务编号"], ...fields,
      }], (record) => record["任务编号"] || record["同步唯一键"]);
    } catch (error) {
      this.logger.error(error);
      return null;
    }
  }

  async writeExceptions(taskId, taskType, failures = []) {
    if (!failures.length) return null;
    return this.upsert(this.tables.exceptions, failures.map((failure, index) => ({
      "同步唯一键": `${taskId}|${failure.key || index}`,
      "任务编号": taskId, "任务类型": taskType, "数据类型": failure.dataType || "unknown",
      "业务键": String(failure.key || ""), "操作": failure.operation || "unknown",
      "异常原因": String(failure.reason || "unknown").slice(0, 500), "处理状态": "待处理",
    })), (record) => record["同步唯一键"]);
  }

  async executeLogged(taskType, job) {
    await this.migrate();
    const taskId = `${taskType}|${Date.now()}`; const startedAt = Date.now();
    try {
      const result = await job();
      const stats = collectStats(result, taskType);
      await this.writeExceptions(taskId, taskType, stats.failures);
      if (stats.failed > 0) throw new Error(`${taskType}存在${stats.failed}条写入失败，已阻止后续结算`);
      await this.writeSyncLog({
        "任务编号": taskId, "任务类型": taskType, "业务日期": dateOnly(new Date()),
        "开始时间": startedAt, "结束时间": Date.now(), "状态": "成功", "总条数": stats.total,
        "新增条数": stats.created, "更新条数": stats.updated, "失败条数": 0,
        "详情": JSON.stringify(result).slice(0, 8000),
      });
      return result;
    } catch (error) {
      await this.writeSyncLog({
        "任务编号": taskId, "任务类型": taskType, "业务日期": dateOnly(new Date()),
        "开始时间": startedAt, "结束时间": Date.now(), "状态": "失败", "总条数": 0,
        "新增条数": 0, "更新条数": 0, "失败条数": 1, "失败原因": error.message,
      });
      throw error;
    }
  }

  async syncOperational({ lookbackDays = 3, refundLookbackDays = 3 } = {}) {
    await this.migrate();
    const now = new Date(); const start = addDays(now, -(lookbackDays - 1));
    const trades = []; const logistics = [];
    for (const [from, to] of dateChunks(start, now, 7)) {
      const range = { startTime: startOfDayString(from), endTime: endOfDayString(to) };
      trades.push(...await this.kdzs.listAll("kdzs.erp.api.trade.list", { timeType: "CREATE_TIME", ...range }, 200));
      logistics.push(...await this.kdzs.listAll("kdzs.erp.api.report.logistics", {
        sendTimeStart: range.startTime, sendTimeEnd: range.endTime,
      }, 200));
    }
    const refunds = await this.kdzs.listAll("kdzs.erp.api.refund.list", {
      modifiedTimeStart: startOfDayString(addDays(now, -(refundLookbackDays - 1))), modifiedTimeEnd: endOfDayString(now),
    });
    const stock = await this.kdzs.listAll("kdzs.erp.api.stock.list");
    return {
      orders: await this.upsertOperationalPartitions("订单", mapNewOrders(trades), "created"),
      orderItems: await this.upsertOperationalPartitions("订单明细", mapNewOrderItems(trades), "created"),
      refunds: await this.upsertOperationalPartitions("售后", mapNewRefunds(refunds), "创建时间"),
      refundItems: await this.upsertOperationalPartitions("售后明细", mapNewRefundItems(refunds), "创建时间"),
      logistics: await this.upsertOperationalPartitions("物流", mapLogistics(logistics), "发货时间"),
      stock: await this.upsert(this.tables.stock, mapNewStock(stock), (f) => f["货品规格ID"]),
    };
  }

  async syncDaily({ profitLookbackDays = this.config.sync.profitLookbackDays, profitDetailLookbackDays = this.config.sync.profitDetailLookbackDays } = {}) {
    await this.migrate();
    const archive = { skipped: true, reason: "订单、明细和物流已改为按月直接分表，不再迁移实时大表" };
    const platformItems = await this.kdzs.listAll("kdzs.erp.api.platform.item.list", { returnSku: true });
    const erpItems = await this.kdzs.listAll("kdzs.erp.api.sys.item.list", { needSkuDetail: true });
    const stockIns = await this.kdzs.listAll("kdzs.erp.api.stock.in.list");
    const purchases = await this.kdzs.listAll("kdzs.erp.api.purchase.list");
    const results = {
      archive,
      platformProducts: await this.upsert(this.tables.platformProducts, mapNewPlatformProducts(platformItems), (f) => f["商品id"]),
      platformSkus: await this.upsert(this.tables.platformSkus, mapNewPlatformSkus(platformItems), (f) => f["同步唯一键"]),
      erpProducts: await this.upsert(this.tables.erpProducts, mapNewErpProducts(erpItems), (f) => String(f.sysItemId || "")),
      erpSkus: await this.upsert(this.tables.erpSkus, mapNewErpSkus(erpItems), (f) => f["同步唯一键"]),
      stockIn: await this.upsert(this.tables.stockIn, mapStockIn(stockIns), (f) => f["同步唯一键"]),
      purchases: await this.upsert(this.tables.purchases, mapPurchases(purchases), (f) => f["同步唯一键"]),
    };
    results.profit = await this.syncProfit({ profitLookbackDays, profitDetailLookbackDays, skipMigrate: true });
    return results;
  }

  async syncProfit({ profitLookbackDays = this.config.sync.profitLookbackDays, profitDetailLookbackDays = this.config.sync.profitDetailLookbackDays,
    startDate, endDate, includeDetails = false, skipMigrate = false } = {}) {
    if (!skipMigrate) await this.migrate();
    const now = endDate ? new Date(endDate) : new Date();
    const rollingStart = startDate ? new Date(startDate) : addDays(now, -(profitLookbackDays - 1));
    const previousStart = monthBounds(previousMonth(now)).start;
    const start = startDate ? new Date(startDate) : (rollingStart < previousStart ? rollingStart : previousStart);
    const todayStart = new Date(`${dateOnly(now)}T00:00:00+08:00`);
    const detailStart = includeDetails ? start : addDays(todayStart, -(profitDetailLookbackDays - 1));
    const raw = []; const curated = []; const orderProfit = []; const productProfit = []; const coverage = [];
    const existingProfitRows = await this.feishu.listRecords(this.tables.storeProfit.id);
    const knownStores = new Map();
    for (const record of existingProfitRows) {
      const fields = record.fields || {}; const store = fieldText(fields["店铺名称"]); const platform = fieldText(fields["平台"]);
      if (store && platform) knownStores.set(`${platform}|${store}`, { platform, sellerNick: store });
    }
    for (const [day] of dateChunks(start, now, 1)) {
      const dayText = dateOnly(day); const range = { queryTimeType: 3, startTime: startOfDayString(day), endTime: endOfDayString(day) };
      try {
        const storeItems = await this.kdzs.listAll("kdzs.erp.api.report.gross.profit", { ...range, queryGroupType: 2 });
        const currentStores = new Set(storeItems.map((item) => `${fieldText(item.platform)}|${fieldText(item.sellerNick)}`));
        for (const item of storeItems) knownStores.set(`${fieldText(item.platform)}|${fieldText(item.sellerNick)}`, { platform: fieldText(item.platform), sellerNick: fieldText(item.sellerNick) });
        const zeroRows = [...knownStores.values()].filter((item) => !currentStores.has(`${item.platform}|${item.sellerNick}`)).map((item) => ({
          ...item, number: 0, payment: 0, paymentCost: 0, paymentProfit: 0, paymentProfitMargin: 0, income: 0,
          postCost: 0, netSalesProfit: 0, netSalesProfitMargin: 0, actualNumber: 0, actualCost: 0, actualPayment: 0,
          refundNum: 0, refundAmount: 0, refundCost: 0, netSales: 0, netSalesNum: 0, netSalesCost: 0, tidCount: 0,
        }));
        const authoritative = [...storeItems, ...zeroRows];
        raw.push(...mapNewStoreProfit(authoritative, dayText)); curated.push(...mapCuratedStoreProfit(authoritative, dayText));
        coverage.push({ "同步唯一键": `profit-day|${dayText}`, "任务编号": `profit-day|${dayText}`, "任务类型": "利润日覆盖", "业务日期": dayText, "状态": "成功", "总条数": storeItems.length, "失败条数": 0 });
        if (includeDetails || day >= detailStart) {
          const orders = await this.kdzs.listAll("kdzs.erp.api.report.gross.profit", { ...range, queryGroupType: 7 });
          const products = await this.kdzs.listAll("kdzs.erp.api.report.gross.profit", { ...range, queryGroupType: 8 });
          orderProfit.push(...mapOrderProfit(orders, dayText)); productProfit.push(...mapProductProfit(products, dayText));
        }
      } catch (error) {
        coverage.push({ "同步唯一键": `profit-day|${dayText}`, "任务编号": `profit-day|${dayText}`, "任务类型": "利润日覆盖", "业务日期": dayText, "状态": "失败", "失败条数": 1, "失败原因": error.message });
        await this.upsert(this.tables.syncLogs, coverage.slice(-1), (f) => f["同步唯一键"]);
        throw error;
      }
    }
    const results = {
      profitRaw: await this.upsert(this.tables.profitRaw, raw, (f) => f["同步唯一键"] || f["文本"]),
      storeProfit: await this.upsert(this.tables.storeProfit, curated, (f) => {
        if (f["同步唯一键"]) return f["同步唯一键"];
        const date = number(f["统计日期"]); return `${date ? dateOnly(new Date(date)) : ""}|${fieldText(f["平台"])}|${fieldText(f["店铺名称"])}`;
      }),
      orderProfit: await this.upsertOperationalPartitions("订单利润", orderProfit, "date"),
      productProfit: await this.upsertOperationalPartitions("商品利润", productProfit, "date"),
      coverage: await this.upsert(this.tables.syncLogs, coverage, (f) => f["同步唯一键"]),
    };
    return results;
  }

  async reconcileMonth(month) {
    await this.migrate();
    const { start, end } = monthBounds(month);
    const [rawRows, curatedRows, logRows] = await Promise.all([
      this.feishu.listRecords(this.tables.profitRaw.id), this.feishu.listRecords(this.tables.storeProfit.id), this.feishu.listRecords(this.tables.syncLogs.id),
    ]);
    const aggregate = (rows, dateField, storeField, profitField, platformField) => {
      const map = new Map();
      for (const record of rows) {
        const fields = record.fields || {}; const timestamp = number(fields[dateField]);
        if (timestamp < start.getTime() || timestamp > end.getTime()) continue;
        const key = `${fieldText(fields[platformField])}|${fieldText(fields[storeField])}|${dateOnly(new Date(timestamp))}`;
        const candidate = { store: fieldText(fields[storeField]), platform: fieldText(fields[platformField]), profit: roundMoney(number(fields[profitField])),
          hasSyncKey: Boolean(fieldText(fields["同步唯一键"])), syncTime: number(fields["同步时间"]) };
        const existing = map.get(key);
        if (!existing || (candidate.hasSyncKey && !existing.hasSyncKey) || candidate.syncTime > existing.syncTime) map.set(key, candidate);
      }
      const totals = new Map(); for (const row of map.values()) totals.set(row.store, roundMoney(number(totals.get(row.store)) + row.profit)); return totals;
    };
    const erp = aggregate(rawRows, "数据日期", "店铺名称", "利润", "platform");
    const feishu = aggregate(curatedRows, "统计日期", "店铺名称", "利润", "平台");
    const coverageDays = new Set(logRows.filter((record) => {
      const fields = record.fields || {}; const day = fieldText(fields["业务日期"]);
      return fieldText(fields["任务类型"]) === "利润日覆盖" && fieldText(fields["状态"]) === "成功" && day >= month + "-01" && day <= dateOnly(end);
    }).map((record) => fieldText(record.fields?.["业务日期"]))).size;
    const expectedDays = daysInMonth(month); const stores = new Set([...erp.keys(), ...feishu.keys()]); const rows = [];
    for (const store of stores) {
      const erpProfit = roundMoney(erp.get(store) || 0); const feishuProfit = roundMoney(feishu.get(store) || 0); const diff = roundMoney(erpProfit - feishuProfit);
      rows.push({ "同步唯一键": `${month}|${store}`, "月份": month, "店铺": store, "ERP利润": erpProfit, "飞书利润": feishuProfit,
        "差额": diff, "覆盖天数": coverageDays, "应覆盖天数": expectedDays,
        "对账状态": coverageDays === expectedDays && Math.abs(diff) <= 0.01 ? "通过" : "不通过", "核对时间": Date.now() });
    }
    const write = await this.upsert(this.tables.reconciliation, rows, (f) => f["同步唯一键"]);
    return { month, coverageDays, expectedDays, rows, write, passed: rows.length > 0 && rows.every((row) => row["对账状态"] === "通过") };
  }

  async archiveMappedRows(name, rows, { updateExisting = true } = {}) {
    if (!rows.length) return { total: 0, created: 0, updated: 0, failed: 0, failures: [] };
    const sample = rows[0];
    const fieldNames = ["同步唯一键", ...Object.keys(sample).filter((key) => key !== "同步唯一键" && key !== SYNC_TIME)];
    const fields = fieldNames.map((fieldName) => ({ field_name: fieldName, type: typeof sample[fieldName] === "number" ? 2 : 1 }));
    const table = await this.feishu.ensureTable(name, fields);
    await this.feishu.ensureField(table.table_id, "同步唯一键", 1);
    await this.feishu.ensureField(table.table_id, SYNC_TIME, 5, { date_formatter: "yyyy/MM/dd HH:mm" });
    return this.upsert({ name, id: table.table_id }, rows, (record) => record["同步唯一键"], { updateExisting });
  }

  async archiveOperationalHistoryLegacy({ retentionDays = 14 } = {}) {
    await this.migrate();
    const cutoff = dateOnly(addDays(new Date(), -retentionDays));
    const [orders, orderItems, logistics, orderProfit, productProfit] = await Promise.all([
      this.feishu.listRecords(this.tables.orders.id), this.feishu.listRecords(this.tables.orderItems.id), this.feishu.listRecords(this.tables.logistics.id),
      this.feishu.listRecords(this.tables.orderProfit.id), this.feishu.listRecords(this.tables.productProfit.id),
    ]);
    const oldOrders = orders.filter((record) => {
      const created = fieldText(record.fields?.created).slice(0, 10); return created && created < cutoff;
    });
    const periodByTid = new Map(oldOrders.map((record) => [fieldText(record.fields?.tid), archivePeriod(fieldText(record.fields?.created).slice(0, 10))]));
    const orderGroups = new Map(); const itemGroups = new Map(); const logisticsGroups = new Map();
    const orderProfitGroups = new Map(); const productProfitGroups = new Map();
    const push = (map, key, value) => { if (!map.has(key)) map.set(key, []); map.get(key).push(value); };
    for (const record of oldOrders) push(orderGroups, periodByTid.get(fieldText(record.fields?.tid)), record);
    for (const record of orderItems) {
      const period = periodByTid.get(fieldText(record.fields?.tid)); if (period) push(itemGroups, period, record);
    }
    for (const record of logistics) {
      const sent = fieldText(record.fields?.["发货时间"]).slice(0, 10); if (sent && sent < cutoff) push(logisticsGroups, archivePeriod(sent), record);
    }
    for (const record of orderProfit) {
      const date = fieldText(record.fields?.date).slice(0, 10); if (date && date < cutoff) push(orderProfitGroups, archivePeriod(date), record);
    }
    for (const record of productProfit) {
      const date = fieldText(record.fields?.date).slice(0, 10); if (date && date < cutoff) push(productProfitGroups, archivePeriod(date), record);
    }
    const results = { orders: [], orderItems: [], logistics: [], orderProfit: [], productProfit: [],
      deleted: { orders: 0, orderItems: 0, logistics: 0, orderProfit: 0, productProfit: 0 } };
    for (const [period, records] of orderGroups) {
      const write = await this.archiveMappedRows(`归档订单_${period}`, records.map((record) => ({ ...record.fields, "同步唯一键": fieldText(record.fields?.["同步唯一键"]) || fieldText(record.fields?.tid) })));
      if (write.failed) throw new Error(`归档订单_${period}存在写入失败，禁止删除源记录`);
      results.orders.push({ period, ...write });
    }
    for (const [period, records] of itemGroups) {
      const write = await this.archiveMappedRows(`归档订单明细_${period}`, records.map((record) => ({ ...record.fields })));
      if (write.failed) throw new Error(`归档订单明细_${period}存在写入失败，禁止删除源记录`);
      results.orderItems.push({ period, ...write });
    }
    for (const [period, records] of logisticsGroups) {
      const write = await this.archiveMappedRows(`归档物流_${period}`, records.map((record) => ({ ...record.fields })));
      if (write.failed) throw new Error(`归档物流_${period}存在写入失败，禁止删除源记录`);
      results.logistics.push({ period, ...write });
    }
    for (const [period, records] of orderProfitGroups) {
      const write = await this.archiveMappedRows(`归档订单利润_${period}`, records.map((record) => ({ ...record.fields })));
      if (write.failed) throw new Error(`归档订单利润_${period}存在写入失败，禁止删除源记录`);
      results.orderProfit.push({ period, ...write });
    }
    for (const [period, records] of productProfitGroups) {
      const write = await this.archiveMappedRows(`归档商品利润_${period}`, records.map((record) => ({ ...record.fields })));
      if (write.failed) throw new Error(`归档商品利润_${period}存在写入失败，禁止删除源记录`);
      results.productProfit.push({ period, ...write });
    }
    if (oldOrders.length) results.deleted.orders = (await this.feishu.batchDelete(this.tables.orders.id, oldOrders.map((record) => record.record_id))).deleted;
    const oldItems = orderItems.filter((record) => periodByTid.has(fieldText(record.fields?.tid)));
    if (oldItems.length) results.deleted.orderItems = (await this.feishu.batchDelete(this.tables.orderItems.id, oldItems.map((record) => record.record_id))).deleted;
    const oldLogistics = [...logisticsGroups.values()].flat();
    if (oldLogistics.length) results.deleted.logistics = (await this.feishu.batchDelete(this.tables.logistics.id, oldLogistics.map((record) => record.record_id))).deleted;
    const oldOrderProfit = [...orderProfitGroups.values()].flat();
    if (oldOrderProfit.length) results.deleted.orderProfit = (await this.feishu.batchDelete(this.tables.orderProfit.id, oldOrderProfit.map((record) => record.record_id))).deleted;
    const oldProductProfit = [...productProfitGroups.values()].flat();
    if (oldProductProfit.length) results.deleted.productProfit = (await this.feishu.batchDelete(this.tables.productProfit.id, oldProductProfit.map((record) => record.record_id))).deleted;
    return results;
  }

  async archiveOperationalHistory({ retentionDays = 14 } = {}) {
    await this.migrate();
    const cutoff = dateOnly(addDays(new Date(), -retentionDays));
    const results = { orders: [], orderItems: [], logistics: [], orderProfit: [], productProfit: [],
      deleted: { orders: 0, orderItems: 0, logistics: 0, orderProfit: 0, productProfit: 0 } };
    const archiveGroups = async (kind, prefix, groups, mapRecord = (record) => ({ ...record.fields })) => {
      for (const [period, records] of groups) {
        const write = await this.archiveMappedRows(`${prefix}${period}`, records.map(mapRecord), { updateExisting: false });
        if (write.total !== records.length) throw new Error(`${prefix}${period}存在缺失唯一键，禁止删除源记录`);
        if (write.failed) throw new Error(`${prefix}${period}存在写入失败，禁止删除源记录`);
        results[kind].push({ period, ...write });
        results.deleted[kind] += (await this.feishu.batchDelete(this.tables[kind].id, records.map((record) => record.record_id))).deleted;
      }
    };
    const group = (records, periodFor) => {
      const output = new Map();
      for (const record of records) {
        const period = periodFor(record);
        if (!period) continue;
        if (!output.has(period)) output.set(period, []);
        output.get(period).push(record);
      }
      return output;
    };

    const orders = await this.feishu.listRecords(this.tables.orders.id);
    const oldOrders = orders.filter((record) => {
      const created = fieldText(record.fields?.created).slice(0, 10);
      return created && created < cutoff;
    });
    const periodByTid = new Map(oldOrders.map((record) => [fieldText(record.fields?.tid), archivePeriod(fieldText(record.fields?.created).slice(0, 10))]));
    await archiveGroups("orders", "归档订单_", group(oldOrders, (record) => periodByTid.get(fieldText(record.fields?.tid))), (record) => ({
      ...record.fields, "同步唯一键": fieldText(record.fields?.["同步唯一键"]) || fieldText(record.fields?.tid),
    }));

    const orderItems = await this.feishu.listRecords(this.tables.orderItems.id);
    await archiveGroups("orderItems", "归档订单明细_", group(orderItems, (record) => periodByTid.get(fieldText(record.fields?.tid))));

    const logistics = await this.feishu.listRecords(this.tables.logistics.id);
    await archiveGroups("logistics", "归档物流_", group(logistics, (record) => {
      const sent = fieldText(record.fields?.["发货时间"]).slice(0, 10);
      return sent && sent < cutoff ? archivePeriod(sent) : "";
    }));

    const orderProfit = await this.feishu.listRecords(this.tables.orderProfit.id);
    await archiveGroups("orderProfit", "归档订单利润_", group(orderProfit, (record) => {
      const date = fieldText(record.fields?.date).slice(0, 10);
      return date && date < cutoff ? archivePeriod(date) : "";
    }));

    const productProfit = await this.feishu.listRecords(this.tables.productProfit.id);
    await archiveGroups("productProfit", "归档商品利润_", group(productProfit, (record) => {
      const date = fieldText(record.fields?.date).slice(0, 10);
      return date && date < cutoff ? archivePeriod(date) : "";
    }));
    return results;
  }

  async releaseArchivedOrders({ retentionDays = 14 } = {}) {
    await this.migrate();
    const cutoff = dateOnly(addDays(new Date(), -retentionDays));
    const orders = await this.feishu.listRecords(this.tables.orders.id);
    const oldOrders = orders.filter((record) => {
      const created = fieldText(record.fields?.created).slice(0, 10);
      return created && created < cutoff;
    });
    const groups = new Map();
    for (const record of oldOrders) {
      const period = archivePeriod(fieldText(record.fields?.created).slice(0, 10));
      if (!groups.has(period)) groups.set(period, []);
      groups.get(period).push(record);
    }
    const result = { cutoff, scanned: orders.length, archived: [], deleted: 0 };
    for (const [period, records] of groups) {
      const write = await this.archiveMappedRows(`归档订单_${period}`, records.map((record) => ({
        ...record.fields, "同步唯一键": fieldText(record.fields?.["同步唯一键"]) || fieldText(record.fields?.tid),
      })), { updateExisting: false });
      if (write.failed || write.created + write.updated !== records.length) {
        throw new Error(`归档订单_${period}核验不完整，禁止删除实时订单`);
      }
      const removed = await this.feishu.batchDelete(this.tables.orders.id, records.map((record) => record.record_id));
      result.archived.push({ period, ...write, deleted: removed.deleted });
      result.deleted += removed.deleted;
    }
    return result;
  }

  async syncBackfill({ startDate = this.config.sync.startDate, endDate = dateOnly(new Date()) } = {}) {
    await this.migrate();
    const start = new Date(`${startDate}T00:00:00+08:00`); const end = new Date(`${endDate}T23:59:59+08:00`);
    const results = { periods: [], refunds: null, profit: null };
    for (const [periodStart, periodEnd, period] of halfMonthRanges(start, end)) {
      const trades = []; const logistics = []; const orderProfit = []; const productProfit = [];
      for (const [from, to] of dateChunks(periodStart, periodEnd, 7)) {
        const range = { startTime: startOfDayString(from), endTime: endOfDayString(to) };
        trades.push(...await this.kdzs.listAll("kdzs.erp.api.trade.list", { timeType: "CREATE_TIME", ...range }, 200));
        logistics.push(...await this.kdzs.listAll("kdzs.erp.api.report.logistics", { sendTimeStart: range.startTime, sendTimeEnd: range.endTime }, 200));
      }
      for (const [day] of dateChunks(periodStart, periodEnd, 1)) {
        const range = { queryTimeType: 3, startTime: startOfDayString(day), endTime: endOfDayString(day) };
        orderProfit.push(...mapOrderProfit(await this.kdzs.listAll("kdzs.erp.api.report.gross.profit", { ...range, queryGroupType: 7 }), dateOnly(day)));
        productProfit.push(...mapProductProfit(await this.kdzs.listAll("kdzs.erp.api.report.gross.profit", { ...range, queryGroupType: 8 }), dateOnly(day)));
      }
      const periodResult = {
        period,
        orders: await this.upsertOperationalPartitions("订单", mapNewOrders(trades), "created"),
        orderItems: await this.upsertOperationalPartitions("订单明细", mapNewOrderItems(trades), "created"),
        logistics: await this.upsertOperationalPartitions("物流", mapLogistics(logistics), "发货时间"),
        orderProfit: await this.upsertOperationalPartitions("订单利润", orderProfit, "date"),
        productProfit: await this.upsertOperationalPartitions("商品利润", productProfit, "date"),
      };
      const stats = collectStats(periodResult, period); if (stats.failed) throw new Error(`${period}归档存在${stats.failed}条失败`);
      results.periods.push(periodResult);
    }
    const refunds = [];
    for (const [from, to] of dateChunks(start, end, 30)) refunds.push(...await this.kdzs.listAll("kdzs.erp.api.refund.list", { createTimeStart: startOfDayString(from), createTimeEnd: endOfDayString(to) }));
    results.refunds = {
      refunds: await this.upsertOperationalPartitions("售后", mapNewRefunds(refunds), "创建时间"),
      refundItems: await this.upsertOperationalPartitions("售后明细", mapNewRefundItems(refunds), "创建时间"),
    };
    results.profit = await this.syncProfit({ startDate: start.toISOString(), endDate: end.toISOString(), includeDetails: false,
      profitDetailLookbackDays: 0, skipMigrate: true });
    return results;
  }
}
