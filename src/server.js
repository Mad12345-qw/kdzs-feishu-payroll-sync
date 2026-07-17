import http from "node:http";
import { getConfig } from "./config.js";
import { FeishuClient } from "./feishu-client.js";
import { createKdzsFromSessionTable } from "./session-provider.js";
import { NewBaseSyncService } from "./new-base-sync.js";
import { NewPayrollService } from "./new-payroll.js";
import { previousMonth } from "./utils.js";

const config = getConfig({ requireKdzs: false });
const feishu = new FeishuClient(config.feishu);
const state = {
  startedAt: new Date().toISOString(),
  schedulerEnabled: config.runtime.schedulerEnabled,
  syncEnabled: config.runtime.syncEnabled,
  running: false,
  lastCheckAt: null,
  lastSuccessAt: null,
  lastError: null,
  lastSyncAt: null,
  lastSyncError: null,
  lastDailySyncAt: null,
  lastDailySyncError: null,
  operationalSyncRunning: false,
  dailySyncRunning: false,
  erpStockTotal: null,
  baseTableCount: null,
};

let syncRunning = false;
let dailyRunning = false;
let lastDailyDate = "";

async function runOperationalSync() {
  if (!config.runtime.syncEnabled || syncRunning || dailyRunning) return false;
  syncRunning = true;
  state.operationalSyncRunning = true;
  try {
    const kdzs = await createKdzsFromSessionTable(feishu, config);
    const service = new NewBaseSyncService({ feishu, kdzs, config });
    await service.executeLogged("小时同步", () => service.syncOperational());
    state.lastSyncAt = new Date().toISOString();
    state.lastSyncError = null;
    return true;
  } catch (error) {
    state.lastSyncError = error.message;
    console.error(error);
    return false;
  } finally {
    syncRunning = false;
    state.operationalSyncRunning = false;
  }
}

async function runDailySync() {
  if (!config.runtime.syncEnabled || dailyRunning || syncRunning) return false;
  dailyRunning = true;
  state.dailySyncRunning = true;
  try {
    const kdzs = await createKdzsFromSessionTable(feishu, config);
    const service = new NewBaseSyncService({ feishu, kdzs, config });
    await service.executeLogged("日同步", () => service.syncDaily({
      profitLookbackDays: config.sync.profitLookbackDays,
      profitDetailLookbackDays: config.sync.profitDetailLookbackDays,
    }));
    const previous = previousMonth(new Date());
    const reconciliation = await service.reconcileMonth(previous);
    const payroll = new NewPayrollService({ feishu, tables: service.tables, config });
    const monthParts = new Intl.DateTimeFormat("en", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit" }).formatToParts(new Date());
    const part = (type) => monthParts.find((item) => item.type === type)?.value;
    const currentMonth = `${part("year")}-${part("month")}`;
    await payroll.prepareMonth(currentMonth);
    await payroll.refreshPerformance(currentMonth);
    const settlement = await payroll.settlePreviousMonth({ settlementDay: config.sync.payrollSettlementDay });
    await payroll.refreshPerformance(previous);
    state.lastDailySyncAt = new Date().toISOString();
    state.lastDailySyncError = settlement.blocked || !reconciliation.passed ? (settlement.reason || "月度利润对账未通过，工资结算已阻断") : null;
  } catch (error) {
    state.lastDailySyncError = error.message;
    console.error(error);
  } finally {
    dailyRunning = false;
    state.dailySyncRunning = false;
  }
}

async function runStartupSync() {
  if (await runOperationalSync()) await runDailySync();
}

async function checkConnections() {
  if (state.running) return;
  state.running = true;
  state.lastCheckAt = new Date().toISOString();
  try {
    const tables = await feishu.request("GET", `/bitable/v1/apps/${config.feishu.baseToken}/tables?page_size=100`);
    const kdzs = await createKdzsFromSessionTable(feishu, config);
    const stock = await kdzs.call("kdzs.erp.api.stock.list", { pageNo: 1, pageSize: 1 });
    state.baseTableCount = tables.total ?? tables.items?.length ?? 0;
    state.erpStockTotal = Number(stock.total || 0);
    state.lastSuccessAt = new Date().toISOString();
    state.lastError = null;
  } catch (error) {
    state.lastError = error.message;
  } finally {
    state.running = false;
  }
}

function responseBody() {
  const healthy = Boolean(state.lastSuccessAt) && !state.lastError;
  return {
    status: healthy ? "ok" : "degraded",
    service: "kdzs-feishu-payroll-sync",
    time: new Date().toISOString(),
    uptimeSeconds: Math.floor(process.uptime()),
    scheduler: state.schedulerEnabled ? "running" : "disabled",
    sync: state.syncEnabled ? "enabled" : "safe-bootstrap",
    feishuBaseConnected: Number.isFinite(state.baseTableCount),
    feishuTableCount: state.baseTableCount,
    erpConnected: Number.isFinite(state.erpStockTotal),
    erpStockTotal: state.erpStockTotal,
    lastCheckAt: state.lastCheckAt,
    lastSuccessAt: state.lastSuccessAt,
    error: state.lastError,
    lastSyncAt: state.lastSyncAt,
    lastSyncError: state.lastSyncError,
    lastDailySyncAt: state.lastDailySyncAt,
    lastDailySyncError: state.lastDailySyncError,
    operationalSyncRunning: state.operationalSyncRunning,
    dailySyncRunning: state.dailySyncRunning,
  };
}

const server = http.createServer((request, response) => {
  if (request.url === "/health" || request.url === "/ready" || request.url === "/") {
    const body = responseBody();
    response.writeHead(body.status === "ok" ? 200 : 503, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify(body));
    return;
  }
  response.writeHead(404, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify({ error: "not_found" }));
});

server.listen(config.runtime.port, "0.0.0.0", () => {
  console.log(`health server listening on ${config.runtime.port}`);
  void checkConnections();
});

if (config.runtime.schedulerEnabled) {
  const interval = Math.max(1, config.runtime.healthIntervalMinutes) * 60000;
  setInterval(() => void checkConnections(), interval).unref();
  if (config.runtime.syncEnabled) {
    // Render 重启可能发生在凌晨任务之后。启动时先补订单/售后/库存，再补商品、利润和工资草稿，
    // 保证当天数据不会因为服务重启而一直等到第二天凌晨。
    setTimeout(() => void runStartupSync(), 15000).unref();
    setInterval(() => void runOperationalSync(), 60 * 60000).unref();
    setInterval(() => {
      const china = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23",
      }).formatToParts(new Date());
      const get = (type) => china.find((part) => part.type === type)?.value;
      const today = `${get("year")}-${get("month")}-${get("day")}`;
      if (get("hour") === "02" && lastDailyDate !== today && !syncRunning && !dailyRunning) {
        lastDailyDate = today;
        void runDailySync();
      }
    }, 60000).unref();
  }
}

process.on("SIGTERM", () => server.close(() => process.exit(0)));
