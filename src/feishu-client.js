import { retry, sleep } from "./utils.js";

export class FeishuClient {
  constructor(config, fetchImpl = globalThis.fetch) {
    this.config = config;
    this.fetch = fetchImpl;
    this.token = "";
    this.tokenExpiresAt = 0;
  }

  async fetchJson(url, options) {
    const controller = new AbortController();
    let timeout;
    try {
      const deadline = new Promise((_, reject) => {
        timeout = setTimeout(() => {
          controller.abort();
          const error = new Error("飞书接口请求超时");
          error.retryable = true;
          reject(error);
        }, this.config.requestTimeoutMs || 30000);
      });
      const request = this.fetch(url, { ...options, signal: controller.signal })
        .then(async (response) => ({ response, json: await response.json() }));
      return await Promise.race([request, deadline]);
    } finally {
      clearTimeout(timeout);
    }
  }

  async getToken() {
    if (this.token && Date.now() < this.tokenExpiresAt - 60000) return this.token;
    let response; let json;
    try {
      ({ response, json } = await this.fetchJson(`${this.config.baseUrl}/auth/v3/tenant_access_token/internal`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ app_id: this.config.appId, app_secret: this.config.appSecret }),
      }));
    } catch (cause) {
      const error = new Error("获取飞书凭证超时或网络异常");
      error.retryable = true;
      error.cause = cause;
      throw error;
    }
    if (!response.ok || json.code !== 0) throw new Error(`获取飞书凭证失败：${json.msg || response.status}`);
    this.token = json.tenant_access_token;
    this.tokenExpiresAt = Date.now() + Number(json.expire || 7200) * 1000;
    return this.token;
  }

  async request(method, endpoint, body) {
    return retry(async () => {
      const token = await this.getToken();
      let response; let json;
      try {
        ({ response, json } = await this.fetchJson(`${this.config.baseUrl}${endpoint}`, {
          method,
          headers: { Authorization: `Bearer ${token}`, "content-type": "application/json;charset=UTF-8" },
          body: body === undefined ? undefined : JSON.stringify(body),
        }));
      } catch (cause) {
        const error = new Error(`飞书接口请求超时或网络异常 (${endpoint})`);
        error.retryable = true;
        error.cause = cause;
        throw error;
      }
      if (!response.ok || json.code !== 0) {
        const error = new Error(`飞书接口失败：${json.msg || response.status} (${endpoint})`);
        error.status = response.status;
        error.code = json.code;
        error.response = json;
        throw error;
      }
      return json.data;
    }, { shouldRetry: (error) => error.retryable || error.status === 429 || error.status >= 500 || [99991400, 99991401, 99991402].includes(error.code) });
  }

  tablePath(tableId, suffix = "") {
    return `/bitable/v1/apps/${this.config.baseToken}/tables/${tableId}${suffix}`;
  }

  async listTables() {
    const data = await this.request("GET", `/bitable/v1/apps/${this.config.baseToken}/tables?page_size=100`);
    return data.items || [];
  }

  async ensureTable(name, fields) {
    const existing = (await this.listTables()).find((table) => table.name === name);
    if (existing) return existing;
    const data = await this.request("POST", `/bitable/v1/apps/${this.config.baseToken}/tables`, {
      table: { name, default_view_name: "表格", fields },
    });
    return data.table || data;
  }

  async listFields(tableId) {
    const data = await this.request("GET", this.tablePath(tableId, "/fields?page_size=100"));
    return data.items || [];
  }

  async ensureField(tableId, fieldName, type = 1, property) {
    const fields = await this.listFields(tableId);
    const existing = fields.find((field) => field.field_name === fieldName);
    if (existing) return existing;
    const created = await this.request("POST", this.tablePath(tableId, "/fields"), {
      field_name: fieldName, type, ...(property ? { property } : {}),
    });
    return created.field || created;
  }

  async updateField(tableId, fieldId, body) {
    return this.request("PUT", this.tablePath(tableId, `/fields/${fieldId}`), body);
  }

  async listRecords(tableId) {
    const records = [];
    let pageToken = "";
    do {
      const query = new URLSearchParams({ page_size: "500" });
      if (pageToken) query.set("page_token", pageToken);
      const data = await this.request("GET", this.tablePath(tableId, `/records?${query}`));
      records.push(...(data.items || []));
      pageToken = data.has_more ? data.page_token : "";
    } while (pageToken);
    return records;
  }

  async batchCreate(tableId, records) {
    const results = [];
    for (let i = 0; i < records.length; i += 100) {
      const chunk = records.slice(i, i + 100).map((fields) => ({ fields }));
      const data = await this.request("POST", this.tablePath(tableId, "/records/batch_create"), { records: chunk });
      results.push(...(data.records || []));
      if (i + 100 < records.length) await sleep(120);
    }
    return results;
  }

  async batchUpdate(tableId, records) {
    const results = [];
    for (let i = 0; i < records.length; i += 100) {
      const chunk = records.slice(i, i + 100);
      const data = await this.request("POST", this.tablePath(tableId, "/records/batch_update"), { records: chunk });
      results.push(...(data.records || []));
      if (i + 100 < records.length) await sleep(120);
    }
    return results;
  }

  async batchDelete(tableId, recordIds) {
    let deleted = 0;
    for (let i = 0; i < recordIds.length; i += 500) {
      const records = recordIds.slice(i, i + 500);
      await this.request("POST", this.tablePath(tableId, "/records/batch_delete"), { records });
      deleted += records.length;
      if (i + 500 < recordIds.length) await sleep(120);
    }
    return { deleted };
  }

  async batchCreateSafe(tableId, records) {
    const output = { succeeded: [], failures: [] };
    const write = async (chunk) => {
      if (!chunk.length) return;
      try {
        const data = await this.request("POST", this.tablePath(tableId, "/records/batch_create"), {
          records: chunk.map((fields) => ({ fields })),
        });
        output.succeeded.push(...(data.records || []));
      } catch (error) {
        if (chunk.length === 1) {
          output.failures.push({ key: chunk[0]["同步唯一键"], reason: error.message });
          return;
        }
        const middle = Math.ceil(chunk.length / 2);
        await write(chunk.slice(0, middle));
        await write(chunk.slice(middle));
      }
    };
    for (let i = 0; i < records.length; i += 100) await write(records.slice(i, i + 100));
    return output;
  }

  async batchUpdateSafe(tableId, records) {
    const output = { succeeded: [], failures: [] };
    const write = async (chunk) => {
      if (!chunk.length) return;
      try {
        const data = await this.request("POST", this.tablePath(tableId, "/records/batch_update"), { records: chunk });
        output.succeeded.push(...(data.records || []));
      } catch (error) {
        if (chunk.length === 1) {
          output.failures.push({ key: chunk[0].fields?.["同步唯一键"], recordId: chunk[0].record_id, reason: error.message });
          return;
        }
        const middle = Math.ceil(chunk.length / 2);
        await write(chunk.slice(0, middle));
        await write(chunk.slice(middle));
      }
    };
    for (let i = 0; i < records.length; i += 100) await write(records.slice(i, i + 100));
    return output;
  }

  async upsert(tableId, incoming, { keyField = "同步唯一键", legacyKey, updateExisting = true }) {
    if (!incoming.length) return { total: 0, created: 0, updated: 0, failed: 0, failures: [] };
    await this.ensureField(tableId, keyField, 1);
    const existing = await this.listRecords(tableId);
    const index = new Map();
    for (const record of existing) {
      const key = record.fields?.[keyField] || legacyKey?.(record.fields || {});
      if (key && !index.has(String(key))) index.set(String(key), record.record_id);
    }
    const creates = [];
    const updates = [];
    const skipped = [];
    let existingCount = 0;
    for (const item of incoming) {
      const key = String(item[keyField] || "");
      if (!key) {
        skipped.push({ operation: "validate", key: "", reason: `缺少唯一键字段：${keyField}` });
        continue;
      }
      const recordId = index.get(key);
      if (recordId && updateExisting) updates.push({ record_id: recordId, fields: item });
      else if (recordId) existingCount += 1;
      else creates.push(item);
    }
    const createResult = await this.batchCreateSafe(tableId, creates);
    const updateResult = await this.batchUpdateSafe(tableId, updates);
    const failures = [
      ...skipped,
      ...createResult.failures.map((failure) => ({ operation: "create", ...failure })),
      ...updateResult.failures.map((failure) => ({ operation: "update", ...failure })),
    ];
    const created = createResult.succeeded.length;
    const updated = updateResult.succeeded.length + existingCount;
    return { total: incoming.length, created, updated, failed: failures.length, failures };
  }
}
