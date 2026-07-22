import { dateOnly, endOfDayString, monthBounds, number, roundMoney, startOfDayString, text } from "./utils.js";

const TABLE_NAMES = {
  entry: "00_系统入口",
  overview: "01_每日财务汇总",
  people: "13_人员表",
  stock: "10_库存快照",
  deductions: "18_提成扣款明细",
  rules: "20_提成规则配置",
  plans: "21_直播计划表",
};

const ROLES = ["主播", "中控", "助播"];
const DEFAULT_RULES = {
  "团队计提比例": 0.2,
  "单件团队封顶": 5,
  "主播分配比例": 0.6,
  "中控分配比例": 0.25,
  "助播分配比例": 0.15,
};

function scalar(value) {
  if (Array.isArray(value)) return value.map((item) => item?.text ?? item?.name ?? item).join("");
  if (value && typeof value === "object") return value.text ?? value.name ?? value.value ?? "";
  return value == null ? "" : String(value);
}
function money(value) { return roundMoney(number(value)); }
function chinaDate(offsetDays = 0) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date(Date.now() + offsetDays * 86400000));
  const get = (type) => parts.find((part) => part.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}
function parseDate(value) {
  if (typeof value === "number") return dateOnly(new Date(value));
  const raw = scalar(value);
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  const timestamp = Number(raw);
  return Number.isFinite(timestamp) && timestamp > 0 ? dateOnly(new Date(timestamp)) : "";
}
function recordDate(fields) { return parseDate(fields?.["日期"] ?? fields?.["统计日期"] ?? fields?.["数据日期"]); }
function sum(rows, field) { return money(rows.reduce((total, row) => total + number(row[field]), 0)); }
function clampRate(value) { return Math.min(1, Math.max(0, number(value))); }
function clampCap(value) { return Math.max(0, money(value)); }
function dateRange(period, date, startDate, endDate) {
  const selected = /^\d{4}-\d{2}-\d{2}$/.test(date || "") ? date : chinaDate();
  if (period === "custom" && /^\d{4}-\d{2}-\d{2}$/.test(startDate || "") && /^\d{4}-\d{2}-\d{2}$/.test(endDate || "")) {
    return { startDate, endDate, label: `${startDate} 至 ${endDate}` };
  }
  if (period === "yesterday") return { startDate: chinaDate(-1), endDate: chinaDate(-1), label: "昨日" };
  if (period === "week") {
    const selectedDate = new Date(`${selected}T00:00:00+08:00`);
    const monday = new Date(selectedDate.getTime() - ((selectedDate.getDay() + 6) % 7) * 86400000);
    return { startDate: parseDate(monday), endDate: selected, label: "本周" };
  }
  if (period === "month") return { startDate: `${selected.slice(0, 7)}-01`, endDate: selected, label: "本月" };
  if (period === "last_month") {
    const [year, month] = selected.slice(0, 7).split("-").map(Number);
    const last = new Date(Date.UTC(year, month - 2, 1));
    const lastMonth = `${last.getUTCFullYear()}-${String(last.getUTCMonth() + 1).padStart(2, "0")}`;
    const end = new Date(Date.UTC(last.getUTCFullYear(), last.getUTCMonth() + 1, 0));
    return { startDate: `${lastMonth}-01`, endDate: `${lastMonth}-${String(end.getUTCDate()).padStart(2, "0")}`, label: "上月" };
  }
  return { startDate: selected, endDate: selected, label: "今日" };
}

export class DashboardService {
  constructor({ feishu, kdzs = null, getKdzs = null, cacheSeconds = 300, dashboardUrl = "", accessToken = "", logger = console }) {
    this.feishu = feishu;
    this.kdzs = kdzs;
    this.getKdzs = getKdzs;
    this.cacheMs = Math.max(15, cacheSeconds) * 1000;
    this.dashboardUrl = dashboardUrl.replace(/\/$/, "");
    this.accessToken = accessToken;
    this.logger = logger;
    this.tables = null;
    this.cache = new Map();
    this.configuration = null;
    this.configurationPromise = null;
  }

  async resolveTables() {
    if (this.tables) return this.tables;
    this.tables = Object.fromEntries((await this.feishu.listTables()).map((table) => [table.name, table]));
    return this.tables;
  }

  async ensureConfiguration() {
    if (this.configuration) return this.configuration;
    if (!this.configurationPromise) {
      this.configurationPromise = this.initializeConfiguration()
        .then((configuration) => { this.configuration = configuration; return configuration; })
        .finally(() => { this.configurationPromise = null; });
    }
    return this.configurationPromise;
  }

  async initializeConfiguration() {
    const tables = await this.resolveTables();
    const entry = await this.feishu.ensureTable(TABLE_NAMES.entry, [
      { field_name: "名称", type: 1 }, { field_name: "访问链接", type: 1 }, { field_name: "说明", type: 1 }, { field_name: "更新时间", type: 5 },
    ]);
    this.tables[TABLE_NAMES.entry] = entry;
    if (this.dashboardUrl) {
      const link = this.accessToken ? `${this.dashboardUrl}/?access=${this.accessToken}` : this.dashboardUrl;
      const current = (await this.feishu.listRecords(entry.table_id)).find((record) => scalar(record.fields?.["名称"]) === "打开经营工作台");
      const fields = { "名称": "打开经营工作台", "访问链接": link, "说明": "老板总览、主播提成、中控与直播协同入口", "更新时间": Date.now() };
      if (current) await this.feishu.batchUpdateSafe(entry.table_id, [{ record_id: current.record_id, fields }]);
      else await this.feishu.batchCreateSafe(entry.table_id, [fields]);
    }

    const people = tables[TABLE_NAMES.people];
    if (!people) throw new Error(`缺少数据表：${TABLE_NAMES.people}`);
    const personFields = [
      ["角色", 3, { options: ROLES.map((name, color) => ({ name, color })) }],
      ["登录账号", 1], ["登录PIN", 1], ["启用提成展示", 3, { options: [{ name: "是", color: 0 }, { name: "否", color: 1 }] }],
    ];
    for (const [name, type, property] of personFields) await this.feishu.ensureField(people.table_id, name, type, property);
    const personRecords = await this.feishu.listRecords(people.table_id);
    const personUpdates = [];
    for (const record of personRecords) {
      const row = record.fields || {}; const patch = {};
      if (!scalar(row["角色"])) patch["角色"] = "主播";
      if (!scalar(row["启用提成展示"])) patch["启用提成展示"] = "是";
      if (Object.keys(patch).length) personUpdates.push({ record_id: record.record_id, fields: patch });
    }
    if (personUpdates.length) await this.feishu.batchUpdateSafe(people.table_id, personUpdates);

    const deductions = await this.feishu.ensureTable(TABLE_NAMES.deductions, [
      { field_name: "扣款唯一键", type: 1 }, { field_name: "日期", type: 5 }, { field_name: "姓名", type: 1 },
      { field_name: "角色", type: 3 }, { field_name: "店铺", type: 1 }, { field_name: "类型", type: 3 },
      { field_name: "金额", type: 2 }, { field_name: "说明", type: 1 }, { field_name: "状态", type: 3 },
    ]);
    this.tables[TABLE_NAMES.deductions] = deductions;

    const rulesTable = await this.feishu.ensureTable(TABLE_NAMES.rules, [
      { field_name: "规则项", type: 1 }, { field_name: "数值", type: 2 }, { field_name: "生效日期", type: 5 },
      { field_name: "状态", type: 3 }, { field_name: "说明", type: 1 },
    ]);
    this.tables[TABLE_NAMES.rules] = rulesTable;
    const rules = await this.feishu.listRecords(rulesTable.table_id);
    if (!rules.length) await this.feishu.batchCreateSafe(rulesTable.table_id, Object.entries(DEFAULT_RULES).map(([name, value]) => ({ "规则项": name, "数值": value, "生效日期": Date.now(), "状态": "启用", "说明": "系统默认规则，可由老板后台修改" })));
    const plans = await this.feishu.ensureTable(TABLE_NAMES.plans, [
      { field_name: "计划日期", type: 5 }, { field_name: "店铺", type: 1 }, { field_name: "直播主题", type: 1 },
      { field_name: "主推商品", type: 1 }, { field_name: "主播安排", type: 1 }, { field_name: "中控安排", type: 1 },
      { field_name: "助播安排", type: 1 }, { field_name: "直播目标", type: 1 }, { field_name: "状态", type: 3 }, { field_name: "备注", type: 1 },
    ]);
    this.tables[TABLE_NAMES.plans] = plans;
    return { people: personRecords.length, deductionsTable: deductions.table_id, rulesTable: rulesTable.table_id, plansTable: plans.table_id };
  }

  async records(name) {
    const table = (await this.resolveTables())[name];
    return table ? this.feishu.listRecords(table.table_id) : [];
  }

  async getRules(asOf) {
    const table = (await this.resolveTables())[TABLE_NAMES.rules] || this.tables[TABLE_NAMES.rules];
    const rows = table ? await this.feishu.listRecords(table.table_id) : [];
    const output = { ...DEFAULT_RULES };
    for (const [name] of Object.entries(DEFAULT_RULES)) {
      const candidates = rows.filter((record) => scalar(record.fields?.["规则项"]) === name && scalar(record.fields?.["状态"]) !== "停用")
        .filter((record) => !parseDate(record.fields?.["生效日期"]) || parseDate(record.fields?.["生效日期"]) <= asOf)
        .sort((a, b) => number(b.fields?.["生效日期"]) - number(a.fields?.["生效日期"]));
      if (candidates.length) output[name] = number(candidates[0].fields?.["数值"]);
    }
    output["团队计提比例"] = clampRate(output["团队计提比例"]);
    output["单件团队封顶"] = clampCap(output["单件团队封顶"]);
    output["主播分配比例"] = clampRate(output["主播分配比例"]);
    output["中控分配比例"] = clampRate(output["中控分配比例"]);
    output["助播分配比例"] = clampRate(output["助播分配比例"]);
    return output;
  }

  async saveRules(input, effectiveDate = chinaDate()) {
    const table = this.tables[TABLE_NAMES.rules] || (await this.resolveTables())[TABLE_NAMES.rules];
    if (!table) throw new Error("规则配置表尚未创建");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate)) throw new Error("生效日期格式不正确");
    const splitKeys = ["主播分配比例", "中控分配比例", "助播分配比例"];
    if (splitKeys.every((key) => input[key] != null) && Math.abs(splitKeys.reduce((total, key) => total + number(input[key]), 0) - 1) > 0.0001) throw new Error("主播、中控、助播分配比例合计必须等于100%");
    const allowed = Object.keys(DEFAULT_RULES);
    const current = await this.feishu.listRecords(table.table_id);
    const updates = []; const creates = [];
    for (const name of allowed) {
      if (input[name] == null) continue;
      const value = name === "单件团队封顶" ? clampCap(input[name]) : clampRate(input[name]);
      const row = current.find((record) => scalar(record.fields?.["规则项"]) === name && parseDate(record.fields?.["生效日期"]) === effectiveDate);
      const fields = { "规则项": name, "数值": value, "生效日期": new Date(`${effectiveDate}T00:00:00+08:00`).getTime(), "状态": "启用", "说明": "老板后台配置" };
      if (row) updates.push({ record_id: row.record_id, fields }); else creates.push(fields);
    }
    if (updates.length) await this.feishu.batchUpdateSafe(table.table_id, updates);
    if (creates.length) await this.feishu.batchCreateSafe(table.table_id, creates);
    return this.getRules(effectiveDate);
  }

  async authenticate(account, pin) {
    const rows = await this.records(TABLE_NAMES.people);
    const match = rows.map((record) => record.fields || {}).find((person) => scalar(person["登录账号"]) === String(account || "") && scalar(person["登录PIN"]) === String(pin || "") && scalar(person["启用提成展示"]) !== "否");
    if (!match) return null;
    return { scope: "employee", name: scalar(match["姓名"]), role: scalar(match["角色"] || "主播"), store: scalar(match["所属店铺"]) };
  }

  async queryClient() { return this.kdzs || (this.getKdzs ? this.getKdzs() : null); }

  async queryOrders(client, startDate, endDate, store, platform) {
    if (!client) return null;
    const trades = await client.listAll("kdzs.erp.api.trade.list", { timeType: "CREATE_TIME", startTime: `${startDate} 00:00:00`, endTime: `${endDate} 23:59:59` }, 200);
    const rows = trades.filter((trade) => (store === "全部店铺" || text(trade.sellerNick) === store) && (platform === "全部平台" || text(trade.platform) === platform));
    return { orderCount: rows.length, sales: money(rows.reduce((total, trade) => total + number(trade.receivedPayment || trade.payment), 0)), rows };
  }

  async queryProfit(client, startDate, endDate, queryTimeType, store, platform) {
    if (!client) return null;
    const rows = await client.listAll("kdzs.erp.api.report.gross.profit", { queryTimeType, queryGroupType: 2, startTime: `${startDate} 00:00:00`, endTime: `${endDate} 23:59:59` });
    return rows.filter((row) => (store === "全部店铺" || text(row.sellerNick) === store) && (platform === "全部平台" || text(row.platform) === platform));
  }

  async queryProducts(client, startDate, endDate, queryTimeType, store, platform) {
    if (!client) return null;
    const rows = await client.listAll("kdzs.erp.api.report.gross.profit", { queryTimeType, queryGroupType: 8, startTime: `${startDate} 00:00:00`, endTime: `${endDate} 23:59:59` });
    return rows.filter((row) => (store === "全部店铺" || text(row.sellerNick) === store) && (platform === "全部平台" || text(row.platform) === platform));
  }

  async queryRefunds(client, startDate, endDate, store) {
    if (!client) return null;
    const rows = await client.listAll("kdzs.erp.api.refund.list", { createTimeStart: `${startDate} 00:00:00`, createTimeEnd: `${endDate} 23:59:59` }, 200);
    return rows.filter((row) => store === "全部店铺" || text(row.sellerNick) === store);
  }

  async mirrorProductRows(startDate, endDate) {
    const tables = await this.resolveTables();
    const candidates = Object.entries(tables).filter(([name]) => name === "03_商品利润明细" || name.startsWith("03_商品利润明细_"));
    const rows = [];
    for (const [, table] of candidates) {
      const records = await this.feishu.listRecords(table.table_id);
      for (const record of records) {
        const fields = record.fields || {}; const date = recordDate(fields);
        if (date < startDate || date > endDate) continue;
        rows.push({ sellerNick: fields["店铺名称"], platform: fields["平台类型"], itemTitle: fields["商品名称"], skuId: fields.SKU_ID || fields["商品编码"], number: fields["销售数量"], payment: fields["销售金额"], netSalesProfit: fields["利润"] });
      }
    }
    return rows;
  }

  calculateProducts(rows, rules, people, startDate, endDate) {
    const map = new Map();
    const splits = { 主播: rules["主播分配比例"], 中控: rules["中控分配比例"], 助播: rules["助播分配比例"] };
    for (const row of rows || []) {
      const key = `${text(row.sellerNick)}|${text(row.platform)}|${text(row.itemTitle)}|${text(row.skuId)}`;
      const item = map.get(key) || {
        key, name: text(row.itemTitle) || "未命名商品", sku: text(row.skuId), store: text(row.sellerNick), platform: text(row.platform),
        quantity: 0, sales: 0, cost: 0, profit: 0, teamCommission: 0, roleCommission: Object.fromEntries(ROLES.map((role) => [role, 0])),
      };
      const quantity = Math.max(0, number(row.number));
      const profit = number(row.netSalesProfit);
      // queryGroupType=8 returns an order-product line. Cap each sold unit first, then aggregate it for display.
      const unitTeamCommission = quantity > 0 && profit > 0
        ? Math.min((profit / quantity) * rules["团队计提比例"], rules["单件团队封顶"])
        : 0;
      const rowTeamCommission = money(unitTeamCommission * quantity);
      item.quantity += quantity; item.sales += number(row.payment); item.cost += number(row.actualCost ?? row.netSalesCost ?? row.costPrice ?? row.cost); item.profit += profit; item.teamCommission += rowTeamCommission;
      for (const role of ROLES) item.roleCommission[role] += money(rowTeamCommission * (splits[role] || 0));
      map.set(key, item);
    }
    const active = people.filter((person) => scalar(person["启用提成展示"]) !== "否");
    const membersByStoreRole = new Map();
    for (const person of active) {
      const key = `${scalar(person["所属店铺"])}|${scalar(person["角色"] || "主播")}`;
      membersByStoreRole.set(key, (membersByStoreRole.get(key) || 0) + 1);
    }
    return [...map.values()].map((item) => {
      const roleCommission = Object.fromEntries(ROLES.map((role) => [role, money(item.roleCommission[role]) ]));
      return { ...item, quantity: Math.round(item.quantity), sales: money(item.sales), cost: money(item.cost), profit: money(item.profit), teamCommission: money(item.teamCommission), roleCommission, periodStart: startDate, periodEnd: endDate };
    });
  }

  async getDashboard({ date, period = "today", startDate, endDate, store = "全部店铺", platform = "全部平台", basis = "placed", viewer = { scope: "owner" } } = {}) {
    const range = dateRange(period, date, startDate, endDate);
    const safeBasis = ["placed", "shipped", "monthly"].includes(basis) ? basis : "placed";
    const key = JSON.stringify({ ...range, store, platform, basis: safeBasis, viewer });
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.time < this.cacheMs) return cached.value;
    const configuration = await this.ensureConfiguration();
    const [peopleRecords, overviewRecords, stockRecords, deductionRecords] = await Promise.all([
      this.records(TABLE_NAMES.people), this.records(TABLE_NAMES.overview), this.records(TABLE_NAMES.stock), this.records(TABLE_NAMES.deductions),
    ]);
    const people = peopleRecords.map((record) => record.fields || {});
    const isOwner = viewer.scope === "owner";
    const effectiveStore = isOwner ? store : viewer.store;
    const client = await this.queryClient();
    const queryType = safeBasis === "placed" ? 1 : 3;
    const previousDate = dateOnly(new Date(new Date(`${range.startDate}T00:00:00+08:00`).getTime() - 86400000));
    const monthRange = { startDate: `${range.endDate.slice(0, 7)}-01`, endDate: range.endDate };
    const [[ordersLive, profitRowsLive, productRowsLive, refundsLive, yesterdayProductRowsLive], monthly] = await Promise.all([
      Promise.all([
      this.queryOrders(client, range.startDate, range.endDate, effectiveStore, platform),
      this.queryProfit(client, range.startDate, range.endDate, queryType, effectiveStore, platform),
      this.queryProducts(client, range.startDate, range.endDate, queryType, effectiveStore, platform),
      this.queryRefunds(client, range.startDate, range.endDate, effectiveStore),
      this.queryProducts(client, previousDate, previousDate, 3, effectiveStore, platform),
      ]),
      isOwner ? Promise.all([
        this.queryProfit(client, monthRange.startDate, monthRange.endDate, 3, effectiveStore, platform),
        this.queryProducts(client, monthRange.startDate, monthRange.endDate, 3, effectiveStore, platform),
        this.queryRefunds(client, monthRange.startDate, monthRange.endDate, effectiveStore),
      ]) : Promise.resolve([null, null, null]),
    ]);
    const allOverview = overviewRecords.map((record) => record.fields || {});
    const inScope = (row) => (effectiveStore === "全部店铺" || scalar(row["店铺名称"]) === effectiveStore)
      && (platform === "全部平台" || scalar(row["平台类型"]) === platform);
    const overview = allOverview.filter((row) => recordDate(row) >= range.startDate && recordDate(row) <= range.endDate && inScope(row));
    const previousRows = allOverview.filter((row) => recordDate(row) === previousDate && (effectiveStore === "全部店铺" || scalar(row["店铺名称"]) === effectiveStore) && (platform === "全部平台" || scalar(row["平台类型"]) === platform));
    const orders = ordersLive || { orderCount: Math.round(sum(overview, "订单数")), sales: sum(overview, "销售金额"), rows: [] };
    const profitRows = profitRowsLive || overview.map((row) => ({ sellerNick: row["店铺名称"], platform: row["平台类型"], netSalesProfit: row["利润"] }));
    const scopedProductRows = (rows) => (rows || []).filter((row) =>
      (effectiveStore === "全部店铺" || text(row.sellerNick) === effectiveStore)
      && (platform === "全部平台" || text(row.platform) === platform));
    const productRows = scopedProductRows(productRowsLive || await this.mirrorProductRows(range.startDate, range.endDate));
    const yesterdayProductRows = scopedProductRows(yesterdayProductRowsLive || await this.mirrorProductRows(previousDate, previousDate));
    const refunds = refundsLive || [];
    const scopedPeople = people.filter((person) => scalar(person["启用提成展示"]) !== "否")
      .filter((person) => viewer.scope === "owner" || scalar(person["姓名"]) === viewer.name)
      .filter((person) => effectiveStore === "全部店铺" || scalar(person["所属店铺"]) === effectiveStore)
      .filter((person) => viewer.scope === "owner" ? true : scalar(person["所属店铺"]) === viewer.store);
    const rules = await this.getRules(range.endDate);
    const products = this.calculateProducts(productRows || [], rules, people, range.startDate, range.endDate);
    const profitPending = Boolean(ordersLive?.orderCount > 0 && profitRowsLive && profitRowsLive.length === 0);
    const scopedDeductions = (start, end) => deductionRecords.map((record) => record.fields || {}).filter((row) => {
      const d = recordDate(row); return d >= start && d <= end && (effectiveStore === "全部店铺" || scalar(row["店铺"]) === effectiveStore);
    });
    const deductions = scopedDeductions(range.startDate, range.endDate);
    const yesterdayDeductions = scopedDeductions(previousDate, previousDate);
    const calculateCommissions = (sourceProducts, sourceDeductions, pending) => scopedPeople.map((person) => {
      const name = scalar(person["姓名"]); const role = scalar(person["角色"] || "主播"); const personStore = scalar(person["所属店铺"]);
      const members = people.filter((item) => scalar(item["所属店铺"]) === personStore && scalar(item["角色"] || "主播") === role && scalar(item["启用提成展示"]) !== "否").length || 1;
      const gross = pending ? null : money(sourceProducts.filter((item) => item.store === personStore).reduce((total, item) => total + number(item.roleCommission[role]) / members, 0));
      const deduction = money(sourceDeductions.filter((row) => scalar(row["姓名"]) === name).reduce((total, row) => total + number(row["金额"]), 0));
      return { name, role, store: personStore, grossCommission: gross, deduction, pending: gross == null, commission: gross == null ? null : money(Math.max(0, gross - deduction)) };
    });
    const commissions = calculateCommissions(products, deductions, profitPending && safeBasis === "placed");
    const yesterdayProducts = this.calculateProducts(yesterdayProductRows, rules, people, previousDate, previousDate);
    const yesterdayPending = Boolean(Math.round(sum(previousRows, "实发数量")) > 0 && yesterdayProductRowsLive && yesterdayProductRowsLive.length === 0);
    const yesterdayCommissions = calculateCommissions(yesterdayProducts, yesterdayDeductions, yesterdayPending);
    const employeeProducts = products.filter((item) => isOwner || item.store === viewer.store).map((item) => {
      const role = viewer.role || "主播"; const members = people.filter((person) => scalar(person["所属店铺"]) === item.store && scalar(person["角色"] || "主播") === role && scalar(person["启用提成展示"]) !== "否").length || 1;
      const personal = money(number(item.roleCommission[role]) / members); return isOwner ? { ...item, personalByRole: Object.fromEntries(ROLES.map((r) => [r, item.roleCommission[r]])) } : { key: item.key, name: item.name, sku: item.sku, quantity: item.quantity, sales: item.sales, personalCommission: personal };
    });
    const totalTeamCommission = profitPending && safeBasis === "placed" ? null : money(products.reduce((total, item) => total + item.teamCommission, 0));
    const profit = money((profitRows || []).reduce((total, row) => total + number(row.netSalesProfit), 0));
    const [monthProfitRowsLive, monthProductRowsLive, monthRefundsLive] = monthly;
    const monthProfit = money((monthProfitRowsLive || []).reduce((total, row) => total + number(row.netSalesProfit), 0));
    const monthProducts = isOwner ? this.calculateProducts(scopedProductRows(monthProductRowsLive || await this.mirrorProductRows(monthRange.startDate, monthRange.endDate)), rules, people, monthRange.startDate, monthRange.endDate) : [];
    const monthDeductions = isOwner ? scopedDeductions(monthRange.startDate, monthRange.endDate) : [];
    const fallbackOrders = overview.reduce((total, row) => total + number(row["订单数"]), 0);
    const summary = {
      orderCount: orders?.orderCount ?? fallbackOrders, sales: orders?.sales ?? sum(overview, "销售金额"),
      profit: profitPending ? null : profit, profitPending, refundAmount: money((refunds || []).reduce((total, row) => total + number(row.refundAmount), 0)), refundCount: refunds?.length ?? 0,
      shippedCount: Math.round(sum(previousRows, "实发数量")), teamCommission: totalTeamCommission,
      monthProfit: monthProfitRowsLive ? monthProfit : null, monthTeamCommission: monthProductRowsLive ? money(monthProducts.reduce((total, item) => total + item.teamCommission, 0)) : null,
      monthAfterSalesLoss: monthRefundsLive ? money((monthRefundsLive || []).reduce((total, row) => total + number(row.refundAmount), 0)) : null,
      afterSalesLoss: money((refunds || []).reduce((total, row) => total + number(row.refundAmount), 0)), misShipmentLoss: money(deductions.filter((row) => scalar(row["类型"]).includes("错发")).reduce((total, row) => total + number(row["金额"]), 0)),
    };
    const visibleDeductions = deductions.filter((row) => isOwner || scalar(row["姓名"]) === viewer.name).map((row) => ({ date: recordDate(row), name: scalar(row["姓名"]), role: scalar(row["角色"]), type: scalar(row["类型"] || "其他"), amount: money(row["金额"]), note: scalar(row["说明"]), status: scalar(row["状态"] || "已记录") }));
    const afterSalesDetails = (refunds || []).map((row) => ({ orderNo: text(row.tid || row.orderId || row.tradeId || row.refundId || "—"), store: text(row.sellerNick), reason: text(row.reason || row.refundReason || row.remark || "售后退款"), status: text(row.refundStatus || row.status || "处理中"), amount: money(row.refundAmount) }));
    const operationalExceptions = isOwner
      ? [...afterSalesDetails.map((item) => ({ ...item, type: "售后退款" })), ...visibleDeductions.map((item) => ({ orderNo: item.date || "—", store: "", reason: item.note, status: item.status, amount: item.amount, type: item.type, name: item.name }))]
      : viewer.role === "中控" ? [...afterSalesDetails.map(({ amount, ...item }) => ({ ...item, type: "售后退款" })), ...deductions.map((row) => ({ orderNo: recordDate(row) || "—", store: scalar(row["店铺"]), reason: scalar(row["说明"]), status: scalar(row["状态"] || "已记录"), type: scalar(row["类型"] || "异常") }))] : [];
    const activePeople = people.filter((person) => scalar(person["启用提成展示"]) !== "否");
    const configurationReminders = [...new Set(activePeople.map((person) => scalar(person["所属店铺"])).filter(Boolean))].flatMap((personStore) => {
      const missing = ROLES.filter((role) => !activePeople.some((person) => scalar(person["所属店铺"]) === personStore && scalar(person["角色"] || "主播") === role));
      return missing.length ? [`店铺「${personStore}」尚未配置${missing.join("、")}；对应岗位份额暂不发放，请在 13_人员表补齐人员角色。`] : [];
    });
    const response = {
      viewer, period: range, rules: isOwner ? rules : null,
      meta: { selectedDate: range.endDate, latestDataDate: range.endDate, basis: safeBasis, basisLabel: safeBasis === "placed" ? "下单成交" : safeBasis === "shipped" ? "已发货" : "月度扣售后", source: "快递助手 ERP 原始接口 → 飞书同步", generatedAt: new Date().toISOString(), isOwner, plansTableId: configuration.plansTable },
      filters: { stores: isOwner ? [...new Set(people.map((row) => scalar(row["所属店铺"])).filter(Boolean))].sort() : [viewer.store], platforms: [...new Set([...(productRows || []).map((row) => text(row.platform)), ...overview.map((row) => scalar(row["平台类型"]))].filter(Boolean))].sort(), roles: isOwner ? ROLES : [viewer.role] },
      summary: isOwner ? summary : { orderCount: summary.orderCount, sales: summary.sales, shippedCount: summary.shippedCount, yesterdayShippedCommission: yesterdayCommissions[0]?.commission ?? null, yesterdayShippedPending: yesterdayCommissions[0]?.pending ?? yesterdayPending, refundCount: viewer.role === "中控" ? summary.refundCount : undefined },
      commissions: commissions.map((item) => isOwner ? item : { name: item.name, role: item.role, store: item.store, pending: item.pending, commission: item.commission }),
      team: isOwner ? ROLES.map((role) => ({ role, pending: commissions.some((item) => item.role === role && item.pending), commission: commissions.some((item) => item.role === role && item.pending) ? null : money(commissions.filter((item) => item.role === role).reduce((total, item) => total + number(item.commission), 0)) })).filter((item) => item.commission != null || item.pending || people.some((p) => scalar(p["角色"]) === item.role)) : [],
      deductions: visibleDeductions,
      operationalExceptions,
      products: employeeProducts,
      reminders: isOwner ? [`${range.label} ERP 利润与售后均来自快递助手原始返回；错发扣款只从责任人个人提成扣除。`, ...(summary.misShipmentLoss > 0 ? [`本期错发损耗 ¥${summary.misShipmentLoss.toFixed(2)}；减少错发可直接增收同等金额。`] : []), ...configurationReminders] : [],
    };
    this.cache.set(key, { time: Date.now(), value: response });
    return response;
  }
}
