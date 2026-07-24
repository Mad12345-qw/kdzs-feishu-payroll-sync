import pg from "pg";

const { Pool } = pg;

export class DashboardSnapshotStore {
  constructor({ connectionString = "", logger = console, pool = null } = {}) {
    this.connectionString = connectionString;
    this.logger = logger;
    this.pool = pool;
    this.initialized = false;
    this.initializing = null;
    this.memory = new Map();
  }

  enabled() { return Boolean(this.pool || this.connectionString); }

  keyFor({ period = "today", store = "全部店铺", platform = "全部平台", basis = "placed", viewer = {} } = {}) {
    if (!viewer?.scope || !["owner", "employee"].includes(viewer.scope)) return "";
    const identity = viewer.scope === "owner" ? "owner" : `employee:${encodeURIComponent(viewer.name || "")}:${encodeURIComponent(viewer.role || "")}:${encodeURIComponent(viewer.store || "")}`;
    return `dashboard:v4:${identity}:${encodeURIComponent(period)}:${encodeURIComponent(store)}:${encodeURIComponent(platform)}:${encodeURIComponent(basis)}`;
  }

  async ensure() {
    if (!this.enabled()) return false;
    if (this.initialized) return true;
    if (!this.initializing) {
      // Render's private PostgreSQL endpoint uses an internal self-signed
      // certificate. The connection stays on Render's private network.
      if (!this.pool) this.pool = new Pool({ connectionString: this.connectionString, ssl: { rejectUnauthorized: false }, max: 3, idleTimeoutMillis: 30000 });
      this.initializing = this.pool.query(`
        CREATE TABLE IF NOT EXISTS dashboard_snapshots (
          snapshot_key TEXT PRIMARY KEY,
          payload JSONB NOT NULL,
          generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          source_updated_at TIMESTAMPTZ
        )
      `).then(() => this.pool.query(`
        CREATE TABLE IF NOT EXISTS dashboard_daily_cache (
          cache_date DATE NOT NULL,
          time_basis SMALLINT NOT NULL,
          orders JSONB NOT NULL DEFAULT '[]'::jsonb,
          store_profits JSONB NOT NULL DEFAULT '[]'::jsonb,
          product_profits JSONB NOT NULL DEFAULT '[]'::jsonb,
          refunds JSONB NOT NULL DEFAULT '[]'::jsonb,
          generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (cache_date, time_basis)
        )
      `)).then(() => this.pool.query(`
        CREATE TABLE IF NOT EXISTS dashboard_reference_cache (
          cache_key TEXT PRIMARY KEY,
          payload JSONB NOT NULL,
          generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `)).then(() => { this.initialized = true; return true; }).finally(() => { this.initializing = null; });
    }
    return this.initializing;
  }

  async read(options) {
    const key = this.keyFor(options);
    if (!key || !(await this.ensure())) return null;
    if (this.memory.has(key)) return this.decorate(this.memory.get(key));
    const result = await this.pool.query("SELECT payload, generated_at FROM dashboard_snapshots WHERE snapshot_key = $1", [key]);
    if (!result.rows.length) return null;
    const row = result.rows[0];
    const payload = row.payload;
    if (!payload?.meta || !payload?.period?.startDate || !payload?.period?.endDate || typeof payload?.summary?.orderCount !== "number") return null;
    const snapshot = { payload, generatedAt: new Date(row.generated_at).toISOString() };
    this.memory.set(key, snapshot);
    return this.decorate(snapshot);
  }

  async write(options, payload) {
    const key = this.keyFor(options);
    if (!key || !payload || !(await this.ensure())) return false;
    const sourceUpdatedAt = payload.meta?.generatedAt || null;
    await this.pool.query(`
      INSERT INTO dashboard_snapshots (snapshot_key, payload, generated_at, source_updated_at)
      VALUES ($1, $2::jsonb, NOW(), $3)
      ON CONFLICT (snapshot_key) DO UPDATE
      SET payload = EXCLUDED.payload, generated_at = EXCLUDED.generated_at, source_updated_at = EXCLUDED.source_updated_at
    `, [key, JSON.stringify(payload), sourceUpdatedAt]);
    this.memory.set(key, { payload: structuredClone(payload), generatedAt: new Date().toISOString() });
    return true;
  }

  async writeDaily({ date, basis, orders = [], storeProfits = [], productProfits = [], refunds = [] }) {
    if (!(await this.ensure())) return false;
    await this.pool.query(`
      INSERT INTO dashboard_daily_cache (cache_date, time_basis, orders, store_profits, product_profits, refunds, generated_at)
      VALUES ($1, $2, $3::jsonb, $4::jsonb, $5::jsonb, $6::jsonb, NOW())
      ON CONFLICT (cache_date, time_basis) DO UPDATE SET
        orders = EXCLUDED.orders, store_profits = EXCLUDED.store_profits, product_profits = EXCLUDED.product_profits,
        refunds = EXCLUDED.refunds, generated_at = EXCLUDED.generated_at
    `, [date, basis, JSON.stringify(orders), JSON.stringify(storeProfits), JSON.stringify(productProfits), JSON.stringify(refunds)]);
    return true;
  }

  async readDailyRange(startDate, endDate) {
    if (!(await this.ensure())) return [];
    const result = await this.pool.query(`
      SELECT cache_date::text AS date, time_basis, orders, store_profits AS "storeProfits", product_profits AS "productProfits", refunds, generated_at
      FROM dashboard_daily_cache WHERE cache_date >= $1::date AND cache_date <= $2::date
      ORDER BY cache_date, time_basis
    `, [startDate, endDate]);
    return result.rows;
  }

  async prune(beforeDate) {
    if (!(await this.ensure())) return false;
    await this.pool.query("DELETE FROM dashboard_daily_cache WHERE cache_date < $1::date", [beforeDate]);
    await this.pool.query("DELETE FROM dashboard_snapshots WHERE generated_at < NOW() - INTERVAL '90 days'");
    return true;
  }

  async writeReference(payload) {
    if (!payload || !(await this.ensure())) return false;
    await this.pool.query(`
      INSERT INTO dashboard_reference_cache (cache_key, payload, generated_at)
      VALUES ('dashboard_reference', $1::jsonb, NOW())
      ON CONFLICT (cache_key) DO UPDATE SET payload = EXCLUDED.payload, generated_at = EXCLUDED.generated_at
    `, [JSON.stringify(payload)]);
    this.memory.set('dashboard_reference', { payload: structuredClone(payload), generatedAt: new Date().toISOString() });
    return true;
  }

  async readReference() {
    if (!(await this.ensure())) return null;
    const cached = this.memory.get('dashboard_reference');
    if (cached) return structuredClone(cached.payload);
    const result = await this.pool.query("SELECT payload, generated_at FROM dashboard_reference_cache WHERE cache_key = 'dashboard_reference'");
    if (!result.rows.length) return null;
    const row = result.rows[0];
    this.memory.set('dashboard_reference', { payload: row.payload, generatedAt: new Date(row.generated_at).toISOString() });
    return structuredClone(row.payload);
  }

  decorate(snapshot) {
    const payload = structuredClone(snapshot.payload);
    payload.meta.fromSnapshot = true;
    payload.meta.snapshotGeneratedAt = snapshot.generatedAt;
    return payload;
  }

  async close() { if (this.pool) await this.pool.end(); }
}
