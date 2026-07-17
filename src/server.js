import http from "node:http";
import { getConfig } from "./config.js";
import { FeishuClient } from "./feishu-client.js";
import { createKdzsFromSessionTable } from "./session-provider.js";
import { NewBaseSyncService } from "./new-base-sync.js";

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
  erpStockTotal: null,
  baseTableCount: null,
};

let syncRunning = false;
let dailyRunning = false;
let lastDailyDate = "";

async function runOperationalSync() {
  if (!config.runtime.syncEnabled || syncRunning) return;
  syncRunning = true;
  try {
    const kdzs = await createKdzsFromSessionTable(feishu, config);
    const service = new NewBaseSyncService({ feishu, kdzs, config });
    await service.syncOperational();
    state.lastSyncAt = new Date().toISOString();
    state.lastSyncError = null;
  } catch (error) {
    state.lastSyncError = error.message;
    console.error(error);
  } finally {
    syncRunning = false;
  }
}

async function runDailySync() {
  if (!config.runtime.syncEnabled || dailyRunning) return;
  dailyRunning = true;
  try {
    const kdzs = await createKdzsFromSessionTable(feishu, config);
    const service = new NewBaseSyncService({ feishu, kdzs, config });
    await service.syncDaily({ profitLookbackDays: config.sync.profitLookbackDays });
    state.lastDailySyncAt = new Date().toISOString();
    state.lastDailySyncError = null;
  } catch (error) {
    state.lastDailySyncError = error.message;
    console.error(error);
  } finally {
    dailyRunning = false;
  }
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
    setTimeout(() => void runOperationalSync(), 15000).unref();
    setInterval(() => void runOperationalSync(), 60 * 60000).unref();
    setInterval(() => {
      const china = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23",
      }).formatToParts(new Date());
      const get = (type) => china.find((part) => part.type === type)?.value;
      const today = `${get("year")}-${get("month")}-${get("day")}`;
      if (get("hour") === "02" && lastDailyDate !== today) {
        lastDailyDate = today;
        void runDailySync();
      }
    }, 60000).unref();
  }
}

process.on("SIGTERM", () => server.close(() => process.exit(0)));
