import crypto from "node:crypto";
import { compactObject, formatChinaDateTime, retry } from "./utils.js";

export function createSignature(params, secret) {
  const joined = Object.entries(params)
    .filter(([key, value]) => key !== "sign" && key && value !== undefined && value !== null && String(value) !== "")
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}${value}`)
    .join("");
  return crypto.createHash("md5").update(`${secret}${joined}${secret}`, "utf8").digest("hex").toUpperCase();
}

function serializeParams(params) {
  return Object.fromEntries(Object.entries(compactObject(params)).map(([key, value]) => {
    if (Array.isArray(value) || (value && typeof value === "object")) return [key, JSON.stringify(value)];
    if (typeof value === "boolean") return [key, value ? "true" : "false"];
    return [key, String(value)];
  }));
}

export class KdzsClient {
  constructor(config, fetchImpl = globalThis.fetch) {
    this.config = config;
    this.fetch = fetchImpl;
    this.session = config.session || "";
    this.onSessionRefresh = config.onSessionRefresh;
  }

  async getSession() {
    if (this.session) return this.session;
    const body = new FormData();
    body.append("appKey", this.config.appKey);
    body.append("appSecret", this.config.appSecret);
    body.append("expires", "86400000");
    const response = await this.fetch(this.config.tokenUrl, { method: "POST", body });
    const json = await response.json();
    const token = json?.data?.accessToken;
    if (!response.ok || !token) throw new Error(`获取快麦 session 失败：${json?.message || response.status}`);
    this.session = token;
    if (this.onSessionRefresh) await this.onSessionRefresh({
      accessToken: token,
      expireTimeStamp: json?.data?.expireTimeStamp,
      response: json,
    });
    return token;
  }

  async call(method, businessParams = {}) {
    return retry(async () => {
      const session = await this.getSession();
      const params = serializeParams({
        method,
        appKey: this.config.appKey,
        timestamp: formatChinaDateTime(),
        format: "json",
        version: "1.0",
        session,
        sign_method: "md5",
        ...businessParams,
      });
      params.sign = createSignature(params, this.config.appSecret);
      const response = await this.fetch(this.config.gateway, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded;charset=UTF-8" },
        body: new URLSearchParams(params),
      });
      const json = await response.json();
      const success = json?.code === 200 && json?.data?.success !== false;
      if (!response.ok || !success) {
        const error = new Error(`快麦接口 ${method} 失败：${json?.data?.message || json?.message || json?.msg || json?.errorMsg || response.status}`);
        error.status = response.status;
        error.response = json;
        if ([401, 403].includes(Number(json?.code))) {
          this.session = "";
          error.retryableAuth = true;
        }
        throw error;
      }
      return json.data;
    }, { shouldRetry: (error) => error.retryableAuth || !error.status || error.status === 429 || error.status >= 500 });
  }

  async listAll(method, params = {}, pageSize = 200) {
    const output = [];
    let pageNo = 1;
    let expectedTotal = null;
    while (true) {
      const data = await this.call(method, { ...params, pageNo, pageSize });
      const list = data?.list || [];
      output.push(...list);
      const reportedTotal = Number(data?.total);
      if (expectedTotal === null && Number.isFinite(reportedTotal) && reportedTotal >= 0) expectedTotal = reportedTotal;
      if (!list.length || (expectedTotal !== null && output.length >= expectedTotal)) break;
      if (pageNo >= 10000) throw new Error(`${method} 分页超过安全上限`);
      pageNo += 1;
    }
    return output;
  }
}
