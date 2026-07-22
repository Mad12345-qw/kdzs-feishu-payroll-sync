import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getConfig } from "./config.js";
import { FeishuClient } from "./feishu-client.js";
import { createDeliveryKdzsClient } from "./session-provider.js";
import { DeliverySyncService } from "./delivery-sync.js";
import { DashboardService } from "./dashboard-service.js";
import { DashboardSnapshotStore } from "./dashboard-snapshot-store.js";
import { addDays, dateOnly } from "./utils.js";

const config = getConfig({ requireKdzs: false });
const feishu = new FeishuClient(config.feishu);
const sourceFeishu = config.feishu.sourceBaseToken
  ? new FeishuClient({ ...config.feishu, baseToken: config.feishu.sourceBaseToken }) : null;
const dashboard = new DashboardService({
  feishu,
  cacheSeconds: Math.max(300, config.runtime.dashboardCacheSeconds),
  dashboardUrl: config.runtime.dashboardUrl,
  accessToken: config.runtime.dashboardAccessToken,
  getKdzs: () => createDeliveryKdzsClient({ feishu: sourceFeishu, config }),
});
const dashboardSnapshots = new DashboardSnapshotStore({ connectionString: config.runtime.databaseUrl });
const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../public");
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
  dashboardSnapshotRunning: false,
  lastDashboardSnapshotAt: null,
  lastDashboardSnapshotError: null,
  erpStockTotal: null,
  baseTableCount: null,
};

let syncRunning = false;
let dailyRunning = false;
let lastDailyDate = "";
let dashboardSnapshotRunning = false;

async function refreshDashboardSnapshot() {
  if (dashboardSnapshotRunning) return false;
  dashboardSnapshotRunning = true;
  state.dashboardSnapshotRunning = true;
  try {
    const options = { period: "today", store: "全部店铺", platform: "全部平台", basis: "placed", viewer: { scope: "owner", name: "老板", role: "老板", store: "全部店铺" } };
    const data = await dashboard.getDashboard(options);
    await dashboardSnapshots.write(options, data);
    state.lastDashboardSnapshotAt = new Date().toISOString();
    state.lastDashboardSnapshotError = null;
    return true;
  } catch (error) {
    state.lastDashboardSnapshotError = error.message;
    console.error(error);
    return false;
  } finally {
    dashboardSnapshotRunning = false;
    state.dashboardSnapshotRunning = false;
  }
}

async function runOperationalSync() {
  if (!config.runtime.syncEnabled || syncRunning || dailyRunning) return false;
  syncRunning = true;
  state.operationalSyncRunning = true;
  try {
    const kdzs = await createDeliveryKdzsClient({ feishu: sourceFeishu, config });
    const service = new DeliverySyncService({ feishu, kdzs });
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
    const part = (type) => parts.find((item) => item.type === type)?.value;
    const today = `${part("year")}-${part("month")}-${part("day")}`;
    // 三天回看覆盖迟到的退款/订单状态；同一唯一键只更新，不重复新增。
    for (const day of [addDays(new Date(`${today}T00:00:00+08:00`), -2), addDays(new Date(`${today}T00:00:00+08:00`), -1), new Date(`${today}T00:00:00+08:00`)]) {
      await service.syncDay(dateOnly(day));
    }
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
    const kdzs = await createDeliveryKdzsClient({ feishu: sourceFeishu, config });
    const service = new DeliverySyncService({ feishu, kdzs });
    // 新版只负责 ERP 原始数据同步与实时提成展示。历史工资表保留，但不再由服务自动生成或月结。
    await service.syncReferenceData();
    state.lastDailySyncAt = new Date().toISOString();
    state.lastDailySyncError = null;
    // A startup catch-up can finish during the 02:00 scheduler window.
    // Mark a successful run for the China calendar day so it is not launched again.
    lastDailyDate = dateOnly();
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
    const kdzs = await createDeliveryKdzsClient({ feishu: sourceFeishu, config });
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
    dashboardSnapshotRunning: state.dashboardSnapshotRunning,
    lastDashboardSnapshotAt: state.lastDashboardSnapshotAt,
    lastDashboardSnapshotError: state.lastDashboardSnapshotError,
  };
}

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".png": "image/png", ".svg": "image/svg+xml",
};

function json(response, status, body) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(JSON.stringify(body));
}

function dashboardAuthorized(request, url) {
  const expected = config.runtime.dashboardAccessToken;
  if (!expected) return true;
  return request.headers["x-dashboard-access"] === expected || url.searchParams.get("access") === expected;
}

function base64url(value) { return Buffer.from(value).toString("base64url"); }
function issueViewerToken(viewer) {
  const payload = base64url(JSON.stringify({ ...viewer, exp: Date.now() + 12 * 60 * 60 * 1000 }));
  const signature = crypto.createHmac("sha256", config.runtime.dashboardSessionSecret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}
function readViewerToken(token) {
  try {
    const [payload, signature] = String(token || "").split(".");
    const expected = crypto.createHmac("sha256", config.runtime.dashboardSessionSecret).update(payload).digest("base64url");
    if (!payload || !signature || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
    const viewer = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return viewer.exp > Date.now() ? viewer : null;
  } catch { return null; }
}
function viewerFromRequest(request, url) {
  if (dashboardAuthorized(request, url)) return { scope: "owner", name: "老板", role: "老板", store: "全部店铺" };
  return readViewerToken(String(request.headers.authorization || "").replace(/^Bearer\s+/i, ""));
}
async function requestBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function servePublic(response, pathname) {
  const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const target = path.resolve(publicDir, relative);
  if (!target.startsWith(`${publicDir}${path.sep}`) && target !== path.join(publicDir, "index.html")) return false;
  try {
    const body = await fs.readFile(target);
    response.writeHead(200, {
      "content-type": CONTENT_TYPES[path.extname(target)] || "application/octet-stream",
      "cache-control": target.endsWith("index.html") ? "no-cache" : "public, max-age=300",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'self'; script-src 'self' https://unpkg.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'self' https://*.feishu.cn https://*.larksuite.com",
    });
    response.end(body);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
  if (url.pathname === "/health" || url.pathname === "/ready") {
    const body = responseBody();
    response.writeHead(body.status === "ok" ? 200 : 503, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify(body));
    return;
  }
  if (url.pathname === "/api/dashboard") {
    const requestStartedAt = process.hrtime.bigint();
    const viewer = viewerFromRequest(request, url);
    if (!viewer) return json(response, 401, { error: "unauthorized" });
    try {
      const options = {
        date: url.searchParams.get("date") || undefined,
        period: url.searchParams.get("period") || "today",
        startDate: url.searchParams.get("startDate") || undefined,
        endDate: url.searchParams.get("endDate") || undefined,
        store: url.searchParams.get("store") || "全部店铺",
        platform: url.searchParams.get("platform") || "全部平台",
        basis: url.searchParams.get("basis") || "placed",
        viewer,
      };
      const data = url.searchParams.get("refresh") === "1" ? null : await dashboardSnapshots.read(options);
      const resolved = data || await dashboard.getDashboard(options);
      // 员工端不返回全量多维表格入口，避免通过原始表绕过个人数据隔离。
      resolved.links = viewer.scope === "owner"
        ? { feishu: config.runtime.feishuBaseUrl, plan: resolved.meta.plansTableId ? `${config.runtime.feishuBaseUrl}?table=${resolved.meta.plansTableId}` : "", doubao: config.runtime.doubaoAiUrl }
        : { doubao: config.runtime.doubaoAiUrl };
      resolved.meta.responseSource = data ? "postgresql_snapshot" : "live_erp";
      resolved.meta.serverResponseMs = Number(process.hrtime.bigint() - requestStartedAt) / 1e6;
      return json(response, 200, resolved);
    } catch (error) {
      console.error(error);
      return json(response, 500, { error: "dashboard_data_failed", message: error.message });
    }
  }
  if (url.pathname === "/api/login" && request.method === "POST") {
    try {
      const body = await requestBody(request);
      const viewer = await dashboard.authenticate(body.account, body.pin);
      if (!viewer) return json(response, 401, { error: "login_failed", message: "账号或 PIN 不正确，或该账号尚未启用。" });
      return json(response, 200, { token: issueViewerToken(viewer), viewer });
    } catch (error) {
      return json(response, 400, { error: "invalid_login_request", message: error.message });
    }
  }
  if (url.pathname === "/api/rules" && request.method === "POST") {
    const viewer = viewerFromRequest(request, url);
    if (!viewer || viewer.scope !== "owner") return json(response, 403, { error: "owner_only" });
    try {
      const body = await requestBody(request);
      const rules = await dashboard.saveRules(body.rules || {}, body.effectiveDate);
      return json(response, 200, { rules });
    } catch (error) {
      return json(response, 400, { error: "rule_save_failed", message: error.message });
    }
  }
  try {
    if (request.method === "GET" && await servePublic(response, url.pathname)) return;
  } catch (error) {
    console.error(error);
    return json(response, 500, { error: "static_file_failed" });
  }
  return json(response, 404, { error: "not_found" });
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
    // 服务重启后立即在后台生成首份真实快照；用户页面无需等待 ERP 请求。
    setTimeout(() => void refreshDashboardSnapshot(), 3000).unref();
    setInterval(() => void runOperationalSync(), 60 * 60000).unref();
    setInterval(() => void refreshDashboardSnapshot(), Math.max(2, config.runtime.dashboardSnapshotRefreshMinutes) * 60000).unref();
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
