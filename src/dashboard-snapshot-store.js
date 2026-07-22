import pg from "pg";

const { Pool } = pg;

export class DashboardSnapshotStore {
  constructor({ connectionString = "", logger = console, pool = null } = {}) {
    this.connectionString = connectionString;
    this.logger = logger;
    this.pool = pool;
    this.initialized = false;
    this.initializing = null;
  }

  enabled() { return Boolean(this.pool || this.connectionString); }

  keyFor({ period = "today", store = "全部店铺", platform = "全部平台", basis = "placed", viewer = {} } = {}) {
    if (viewer.scope !== "owner" || period !== "today" || store !== "全部店铺" || platform !== "全部平台" || basis !== "placed") return "";
    return "owner:today:all-stores:all-platforms:placed";
  }

  async ensure() {
    if (!this.enabled()) return false;
    if (this.initialized) return true;
    if (!this.initializing) {
      if (!this.pool) this.pool = new Pool({ connectionString: this.connectionString, ssl: { rejectUnauthorized: true }, max: 3, idleTimeoutMillis: 30000 });
      this.initializing = this.pool.query(`
        CREATE TABLE IF NOT EXISTS dashboard_snapshots (
          snapshot_key TEXT PRIMARY KEY,
          payload JSONB NOT NULL,
          generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          source_updated_at TIMESTAMPTZ
        )
      `).then(() => { this.initialized = true; return true; }).finally(() => { this.initializing = null; });
    }
    return this.initializing;
  }

  async read(options) {
    const key = this.keyFor(options);
    if (!key || !(await this.ensure())) return null;
    const result = await this.pool.query("SELECT payload, generated_at FROM dashboard_snapshots WHERE snapshot_key = $1", [key]);
    if (!result.rows.length) return null;
    const row = result.rows[0];
    const payload = row.payload;
    if (!payload?.meta || !payload?.summary) return null;
    payload.meta.fromSnapshot = true;
    payload.meta.snapshotGeneratedAt = new Date(row.generated_at).toISOString();
    return payload;
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
    return true;
  }

  async close() { if (this.pool) await this.pool.end(); }
}
