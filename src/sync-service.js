import { TABLES } from "./tables.js";
import { mapErpItems, mapOrders, mapPlatformItems, mapRefunds, mapStock, mapStoreProfit } from "./mappings.js";
import { addDays, dateChunks, dateOnly, endOfDayString, parseLocalDate, startOfDayString, writeJsonLog } from "./utils.js";
import { ensurePayrollFields, preparePayrollMonth, settlePreviousMonth } from "./payroll.js";

export class SyncService {
  constructor({ kdzs, feishu, config, logger = console }) {
    this.kdzs = kdzs;
    this.feishu = feishu;
    this.config = config;
    this.logger = logger;
  }

  async migrate() {
    for (const table of [TABLES.orders, TABLES.refunds, TABLES.stock, TABLES.platformItems, TABLES.erpItems, TABLES.storeProfit]) {
      await this.feishu.ensureField(table.id, "同步唯一键", 1);
      await this.feishu.ensureField(table.id, "同步时间", 5, { date_formatter: "yyyy-MM-dd HH:mm" });
    }
    await ensurePayrollFields(this.feishu);
    return { migrated: true };
  }

  stamp(rows) {
    const timestamp = Date.now();
    return rows.map((row) => ({ ...row, "同步时间": timestamp }));
  }

  async syncAll({ full = false } = {}) {
    const startedAt = new Date();
    await this.migrate();
    const results = {};
    const jobs = [
      ["orders", () => this.syncOrders(full)], ["refunds", () => this.syncRefunds(full)],
      ["erpItems", () => this.syncErpItems()], ["platformItems", () => this.syncPlatformItems()],
      ["stock", () => this.syncStock()], ["storeProfit", () => this.syncProfit(full)],
    ];
    for (const [name, job] of jobs) {
      this.logger.info(`开始同步 ${name}`);
      try { results[name] = await job(); } catch (error) {
        results[name] = { failed: true, reason: error.message, details: error.response };
        this.logger.error(error);
      }
    }
    results.payrollDraft = await preparePayrollMonth(this.feishu);
    const criticalFailure = ["orders", "refunds", "storeProfit"].some((name) => results[name]?.failed || results[name]?.failed > 0);
    results.payroll = criticalFailure
      ? { skipped: true, reason: "订单、售后或利润同步不完整，系统已禁止工资月结" }
      : await settlePreviousMonth(this.feishu, { settlementDay: this.config.sync.payrollSettlementDay });
    const summary = { startedAt: startedAt.toISOString(), finishedAt: new Date().toISOString(), full, results };
    summary.logFile = writeJsonLog("sync", summary);
    return summary;
  }

  async syncOrders(full) {
    const now = new Date();
    const start = full ? parseLocalDate(this.config.sync.startDate) : addDays(now, -(this.config.sync.orderLookbackDays - 1));
    const chunks = dateChunks(start, now, full ? 29 : 3);
    const all = [];
    for (const [from, to] of chunks) {
      const params = {
        timeType: full ? this.config.kdzs.tradeCreatedTimeType : this.config.kdzs.tradeModifiedTimeType,
        startTime: startOfDayString(from), endTime: endOfDayString(to),
      };
      all.push(...await this.kdzs.listAll("kdzs.erp.api.trade.list", params, 100));
    }
    return this.feishu.upsert(TABLES.orders.id, this.stamp(mapOrders(all)), {
      legacyKey: (fields) => `${fields.tid || ""}|${fields["子订单ID"] || fields["平台子订单号"] || ""}`,
    });
  }

  async syncRefunds(full) {
    const now = new Date();
    const start = full ? parseLocalDate(this.config.sync.startDate) : addDays(now, -(this.config.sync.refundLookbackDays - 1));
    const all = [];
    for (const [from, to] of dateChunks(start, now, 30)) {
      const params = full
        ? { createTimeStart: startOfDayString(from), createTimeEnd: endOfDayString(to) }
        : { modifiedTimeStart: startOfDayString(from), modifiedTimeEnd: endOfDayString(to) };
      all.push(...await this.kdzs.listAll("kdzs.erp.api.refund.list", params));
    }
    return this.feishu.upsert(TABLES.refunds.id, this.stamp(mapRefunds(all)), {
      legacyKey: (fields) => `${fields["退款编号"] || ""}|${fields["商家规格编码"] || ""}|${fields["商品标题"] || ""}|${fields["规格名称"] || ""}`,
    });
  }

  async syncErpItems() {
    const all = await this.kdzs.listAll("kdzs.erp.api.sys.item.list", { needSkuDetail: true });
    return this.feishu.upsert(TABLES.erpItems.id, this.stamp(mapErpItems(all)), {
      legacyKey: (fields) => `${fields["系统商品ID"] || ""}|${fields["系统SKU_ID"] || "NO_SKU"}`,
    });
  }

  async syncPlatformItems() {
    const all = await this.kdzs.listAll("kdzs.erp.api.platform.item.list", { returnSku: true });
    return this.feishu.upsert(TABLES.platformItems.id, this.stamp(mapPlatformItems(all)), {
      legacyKey: (fields) => `${fields["商品ID"] || ""}|${fields["SKU_ID"] || "NO_SKU"}`,
    });
  }

  async syncStock() {
    const all = await this.kdzs.listAll("kdzs.erp.api.stock.list");
    return this.feishu.upsert(TABLES.stock.id, this.stamp(mapStock(all)), {
      legacyKey: (fields) => String(fields["系统SKU_ID"] || ""),
    });
  }

  async syncProfit(full) {
    const now = new Date();
    const start = full ? parseLocalDate(this.config.sync.startDate) : addDays(now, -(this.config.sync.profitLookbackDays - 1));
    const rows = [];
    for (const [day] of dateChunks(start, now, 1)) {
      const dayText = dateOnly(day);
      const items = await this.kdzs.listAll("kdzs.erp.api.report.gross.profit", {
        queryTimeType: 3, queryGroupType: 2, startTime: startOfDayString(day), endTime: endOfDayString(day),
      });
      rows.push(...mapStoreProfit(items, dayText));
    }
    return this.feishu.upsert(TABLES.storeProfit.id, this.stamp(rows), {
      legacyKey: (fields) => {
        const date = Number(fields["日期"]); const day = Number.isFinite(date) ? dateOnly(new Date(date)) : "";
        return `${day}|${fields["平台类型"] || ""}|${fields["店铺名称"] || ""}`;
      },
    });
  }
}
