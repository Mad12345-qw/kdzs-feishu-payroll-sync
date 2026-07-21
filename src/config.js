import fs from "node:fs";
import path from "node:path";

export function loadEnv(file = path.resolve(process.cwd(), ".env")) {
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const pos = line.indexOf("=");
    if (pos < 1) continue;
    const key = line.slice(0, pos).trim();
    let value = line.slice(pos + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

function integer(name, fallback) {
  const value = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(value) ? value : fallback;
}

export function getConfig({ requireKdzs = true } = {}) {
  loadEnv();
  const config = {
    feishu: {
      appId: process.env.FEISHU_APP_ID,
      appSecret: process.env.FEISHU_APP_SECRET,
      // 业务和工资只写客户交付库；ERP session 只从技术库读取。
      // 禁止旧 FEISHU_BASE_TOKEN（历史上指向 LJB0）覆盖客户业务库。
      baseToken: process.env.DELIVERY_BASE_TOKEN,
      sourceBaseToken: process.env.ERP_SOURCE_BASE_TOKEN,
      baseUrl: "https://open.feishu.cn/open-apis",
      requestTimeoutMs: integer("FEISHU_REQUEST_TIMEOUT_MS", 30000),
    },
    kdzs: {
      appKey: process.env.KDZS_APP_KEY,
      appSecret: process.env.KDZS_APP_SECRET,
      session: process.env.KDZS_SESSION,
      gateway: process.env.KDZS_GATEWAY || "https://gw.kuaidizs.cn/open/api",
      tokenUrl: process.env.KDZS_TOKEN_URL || "http://gw.superboss.cc/api/token",
      requestTimeoutMs: integer("KDZS_REQUEST_TIMEOUT_MS", 30000),
      tradeModifiedTimeType: process.env.KDZS_TRADE_MODIFIED_TIME_TYPE || "MODIFIED_TIME",
      tradeCreatedTimeType: process.env.KDZS_TRADE_CREATED_TIME_TYPE || "CREATE_TIME",
    },
    sync: {
      startDate: process.env.SYNC_START_DATE || "2026-01-01",
      orderLookbackDays: integer("ORDER_LOOKBACK_DAYS", 3),
      refundLookbackDays: integer("REFUND_LOOKBACK_DAYS", 45),
      profitLookbackDays: integer("PROFIT_LOOKBACK_DAYS", 45),
      profitDetailLookbackDays: integer("PROFIT_DETAIL_LOOKBACK_DAYS", 3),
      payrollSettlementDay: integer("PAYROLL_SETTLEMENT_DAY", 15),
    },
    runtime: {
      port: integer("PORT", 3000),
      schedulerEnabled: String(process.env.SCHEDULER_ENABLED || "true").toLowerCase() === "true",
      syncEnabled: String(process.env.SYNC_ENABLED || "false").toLowerCase() === "true",
      healthIntervalMinutes: integer("HEALTH_INTERVAL_MINUTES", 10),
      sessionTableId: process.env.FEISHU_SESSION_TABLE_ID || "tblDvIDJSSxHqKj8",
      dashboardAccessToken: process.env.DASHBOARD_ACCESS_TOKEN || "",
      dashboardCacheSeconds: integer("DASHBOARD_CACHE_SECONDS", 90),
      feishuBaseUrl: process.env.FEISHU_BASE_URL || "https://dcnx0esypql0.feishu.cn/base/SgoybTSbCa1G25s81rbcsBcxnJd",
      doubaoAiUrl: process.env.DOUBAO_AI_URL || "https://www.doubao.com/",
    },
    logLevel: process.env.LOG_LEVEL || "info",
  };

  const missing = [];
  if (!config.feishu.appId) missing.push("FEISHU_APP_ID");
  if (!config.feishu.appSecret) missing.push("FEISHU_APP_SECRET");
  if (!config.feishu.baseToken) missing.push("DELIVERY_BASE_TOKEN");
  const hasDirectKdzsCredentials = Boolean(config.kdzs.appKey && config.kdzs.appSecret);
  if (requireKdzs && !config.kdzs.appKey) missing.push("KDZS_APP_KEY");
  if (requireKdzs && !config.kdzs.appSecret) missing.push("KDZS_APP_SECRET");
  if (!hasDirectKdzsCredentials && !config.feishu.sourceBaseToken) missing.push("ERP_SOURCE_BASE_TOKEN（或配置 KDZS_APP_KEY / KDZS_APP_SECRET）");
  if (missing.length) throw new Error(`缺少配置：${missing.join("、")}`);
  return config;
}
