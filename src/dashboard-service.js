import { dateOnly, endOfDayString, monthBounds, number, roundMoney, startOfDayString, text } from "./utils.js";

const TABLE_NAMES = {
  entry: "00_系统入口",
  overview: "01_每日财务汇总",
  people: "13_人员表",
  stock: "10_库存快照",
  deductions: "18_提成扣款明细",
};

const ROLE_ORDER = ["主播", "中控", "助播", "员工"];

function scalar(value) {
  if (Array.isArray(value)) return value.map((item) => item?.text ?? item?.name ?? item).join("");
  if (value && typeof value === "object") return value.text ?? value.name ?? value.value ?? "";
  return value == null ? "" : String(value);
}

function money(value) { return roundMoney(number(value)); }
function chinaDate(offsetDays = 0) {
  const now = new Date(Date.now() + offsetDays * 86400000);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const get = (type) => parts.find((part) => part.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function recordDate(fields) {
  const raw = fields?.["日期"] ?? fields?.["统计日期"] ?? fields?.["数据日期"];
  if (typeof raw === "number") return dateOnly(new Date(raw));
  const value = scalar(raw);
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  const timestamp = Number(value);
  return Number.isFinite(timestamp) && timestamp > 0 ? dateOnly(new Date(timestamp)) : "";
}

function sum(rows, field) { return money(rows.reduce((total, row) => total + number(row[field]), 0)); }
function selectRate(person, basis) {
  const field = basis === "placed" ? "下单提成比例" : basis === "shipped" ? "发货提成比例" : "月结提成比例";
  return number(person[field] ?? person["提成百分比"]);
}

export class DashboardService {
  constructor({ feishu, kdzs = null, getKdzs = null, cacheSeconds = 90, dashboardUrl = "", accessToken = "", logger = console }) {
    this.feishu = feishu;
    this.kdzs = kdzs;
    this.getKdzs = getKdzs;
    this.cacheMs = Math.max(15, cacheSeconds) * 1000;
    this.dashboardUrl = dashboardUrl.replace(/\/$/, "");
    this.accessToken = accessToken;
    this.logger = logger;
    this.tables = null;
    this.cache = new Map();
  }

  async resolveTables() {
    if (this.tables) return this.tables;
    const tables = await this.feishu.listTables();
    this.tables = Object.fromEntries(tables.map((table) => [table.name, table]));
    return this.tables;
  }

  async ensureConfiguration() {
    const tables = await this.resolveTables();
    const entry = await this.feishu.ensureTable(TABLE_NAMES.entry, [
      { field_name: "名称", type: 1 }, { field_name: "访问链接", type: 1 }, { field_name: "说明", type: 1 }, { field_name: "更新时间", type: 5 },
    ]);
    this.tables[TABLE_NAMES.entry] = entry;
    if (this.dashboardUrl) {
      const link = this.accessToken ? `${this.dashboardUrl}/?access=${this.accessToken}` : this.dashboardUrl;
      const existingEntry = await this.feishu.listRecords(entry.table_id);
      const current = existingEntry.find((record) => scalar(record.fields?.["名称"]) === "打开经营工作台");
      const fields = { "名称": "打开经营工作台", "访问链接": link, "说明": "老板总览、主播提成、中控与直播协同入口", "更新时间": Date.now() };
      if (current) await this.feishu.batchUpdateSafe(entry.table_id, [{ record_id: current.record_id, fields }]);
      else await this.feishu.batchCreateSafe(entry.table_id, [fields]);
    }
    const people = tables[TABLE_NAMES.people];
    if (!people) throw new Error(`缺少数据表：${TABLE_NAMES.people}`);
    const fields = [
      ["角色", 3, { options: ROLE_ORDER.map((name, color) => ({ name, color })) }],
      ["下单提成比例", 2, { formatter: "0.00%" }],
      ["发货提成比例", 2, { formatter: "0.00%" }],
      ["月结提成比例", 2, { formatter: "0.00%" }],
      ["启用提成展示", 3, { options: [{ name: "是", color: 0 }, { name: "否", color: 1 }] }],
    ];
    for (const [name, type, property] of fields) await this.feishu.ensureField(people.table_id, name, type, property);

    const records = await this.feishu.listRecords(people.table_id);
    const updates = [];
    for (const record of records) {
      const row = record.fields || {};
      const defaultRate = number(row["提成百分比"]);
      const patch = {};
      if (!scalar(row["角色"])) patch["角色"] = "主播";
      if (!scalar(row["启用提成展示"])) patch["启用提成展示"] = "是";
      if (row["下单提成比例"] == null) patch["下单提成比例"] = defaultRate;
      if (row["发货提成比例"] == null) patch["发货提成比例"] = defaultRate;
      if (row["月结提成比例"] == null) patch["月结提成比例"] = defaultRate;
      if (Object.keys(patch).length) updates.push({ record_id: record.record_id, fields: patch });
    }
    if (updates.length) await this.feishu.batchUpdateSafe(people.table_id, updates);

    const deductions = await this.feishu.ensureTable(TABLE_NAMES.deductions, [
      { field_name: "扣款唯一键", type: 1 }, { field_name: "日期", type: 5 }, { field_name: "姓名", type: 1 },
      { field_name: "角色", type: 3 }, { field_name: "店铺", type: 1 }, { field_name: "类型", type: 3 },
      { field_name: "金额", type: 2 }, { field_name: "说明", type: 1 }, { field_name: "状态", type: 3 },
    ]);
    this.tables[TABLE_NAMES.deductions] = deductions;
    return { people: records.length, defaultsUpdated: updates.length, deductionsTable: deductions.table_id, entryTable: entry.table_id };
  }

  async records(name) {
    const tables = await this.resolveTables();
    const table = tables[name];
    return table ? this.feishu.listRecords(table.table_id) : [];
  }

  async productRows(day) {
    const tables = await this.resolveTables();
    const month = day.slice(0, 7);
    const half = Number(day.slice(8, 10)) <= 14 ? "01-14" : "15-end";
    const candidates = [
      `03_商品利润明细_${month}_${half}`,
      "03_商品利润明细",
    ];
    const table = candidates.map((name) => tables[name]).find(Boolean);
    if (!table) return [];
    const records = await this.feishu.listRecords(table.table_id);
    return records.map((record) => record.fields || {}).filter((row) => recordDate(row) === day);
  }

  async queryCommissionBase({ date, yesterday, month, basis, store, platform }) {
    const client = this.kdzs || (this.getKdzs ? await this.getKdzs() : null);
    if (!client) return null;
    const isPlaced = basis === "placed";
    const isMonthly = basis === "monthly";
    const day = isPlaced ? date : yesterday;
    const bounds = isMonthly ? monthBounds(month) : {
      start: new Date(`${day}T00:00:00+08:00`), end: new Date(`${day}T23:59:59+08:00`),
    };
    const items = await client.listAll("kdzs.erp.api.report.gross.profit", {
      // 经实测，1 与 3 返回不同的统计集：下单展示使用 1，发货/月结使用 3。
      queryTimeType: isPlaced ? 1 : 3,
      queryGroupType: 2,
      startTime: startOfDayString(bounds.start), endTime: endOfDayString(bounds.end),
    });
    return items.map((item) => ({
      "店铺名称": text(item.sellerNick), "平台类型": text(item.platform), "利润": money(item.netSalesProfit),
    })).filter((row) => (store === "全部店铺" || row["店铺名称"] === store)
      && (platform === "全部平台" || row["平台类型"] === platform));
  }

  async getDashboard({ date, store = "全部店铺", platform = "全部平台", basis = "placed", role = "全部角色" } = {}) {
    const safeBasis = ["placed", "shipped", "monthly"].includes(basis) ? basis : "placed";
    const key = JSON.stringify({ date, store, platform, basis: safeBasis, role });
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.time < this.cacheMs) return cached.value;

    await this.ensureConfiguration();
    const [overviewRecords, peopleRecords, deductionRecords, stockRecords] = await Promise.all([
      this.records(TABLE_NAMES.overview), this.records(TABLE_NAMES.people), this.records(TABLE_NAMES.deductions), this.records(TABLE_NAMES.stock),
    ]);
    const overview = overviewRecords.map((record) => record.fields || {}).map((fields) => ({ ...fields, __date: recordDate(fields) }));
    const dates = [...new Set(overview.map((row) => row.__date).filter(Boolean))].sort().reverse();
    const selectedDate = /^\d{4}-\d{2}-\d{2}$/.test(date || "") ? date : (dates.includes(chinaDate()) ? chinaDate() : dates[0] || chinaDate());
    const yesterday = dateOnly(new Date(`${selectedDate}T00:00:00+08:00`).getTime() - 86400000);
    const month = selectedDate.slice(0, 7);
    const stores = [...new Set(overview.map((row) => scalar(row["店铺名称"])).filter(Boolean))].sort();
    const platforms = [...new Set(overview.map((row) => scalar(row["平台类型"] ?? row["平台"])).filter(Boolean))].sort();
    const matchesDimension = (row) => (store === "全部店铺" || scalar(row["店铺名称"]) === store)
      && (platform === "全部平台" || scalar(row["平台类型"] ?? row["平台"]) === platform);
    const dayRows = overview.filter((row) => row.__date === selectedDate && matchesDimension(row));
    const yesterdayRows = overview.filter((row) => row.__date === yesterday && matchesDimension(row));
    const monthRows = overview.filter((row) => row.__date.startsWith(month) && matchesDimension(row));
    let basisRows = safeBasis === "monthly" ? monthRows : safeBasis === "shipped" ? yesterdayRows : dayRows;
    let commissionSource = "飞书已同步的 ERP 数据";
    try {
      const liveRows = await this.queryCommissionBase({ date: selectedDate, yesterday, month, basis: safeBasis, store, platform });
      if (liveRows) {
        basisRows = liveRows;
        commissionSource = "快递助手 ERP 实时毛利报表";
      }
    } catch (error) {
      this.logger.warn(`提成口径实时查询失败，已回退到已同步 ERP 数据：${error.message}`);
    }

    const people = peopleRecords.map((record) => record.fields || {}).filter((person) => scalar(person["启用提成展示"]) !== "否")
      .filter((person) => store === "全部店铺" || scalar(person["所属店铺"]) === store)
      .filter((person) => role === "全部角色" || scalar(person["角色"] || "主播") === role);
    const profitByStore = new Map();
    for (const row of basisRows) {
      const name = scalar(row["店铺名称"]);
      profitByStore.set(name, money((profitByStore.get(name) || 0) + number(row["利润"])));
    }
    const commissions = people.map((person) => {
      const personStore = scalar(person["所属店铺"]);
      const rate = selectRate(person, safeBasis);
      const profit = money(profitByStore.get(personStore) || 0);
      const deduction = deductionRecords.map((record) => record.fields || {}).filter((item) => {
        const itemDate = recordDate(item); const itemMonth = itemDate.slice(0, 7);
        return scalar(item["姓名"]) === scalar(person["姓名"])
          && (safeBasis === "monthly" ? itemMonth === month : itemDate === (safeBasis === "shipped" ? yesterday : selectedDate));
      }).reduce((total, item) => total + number(item["金额"]), 0);
      return {
        name: scalar(person["姓名"]), role: scalar(person["角色"] || "主播"), store: personStore,
        rate, profit, grossCommission: money(Math.max(0, profit) * rate), deduction: money(deduction),
        commission: money(Math.max(0, profit) * rate - deduction),
      };
    });
    const team = ROLE_ORDER.map((teamRole) => {
      const members = commissions.filter((item) => item.role === teamRole);
      return { role: teamRole, members: members.length, commission: money(members.reduce((total, item) => total + item.commission, 0)) };
    }).filter((item) => item.members);

    const productsRaw = await this.productRows(selectedDate);
    const productMap = new Map();
    for (const row of productsRaw.filter(matchesDimension)) {
      const name = scalar(row["商品名称"]) || "未命名商品";
      const current = productMap.get(name) || { name, sales: 0, quantity: 0, profit: 0, sku: scalar(row.SKU_ID ?? row["商品编码"]) };
      current.sales += number(row["销售金额"] ?? row["实际收入"]);
      current.quantity += number(row["销售数量"] ?? row["净销量"]);
      current.profit += number(row["利润"]);
      productMap.set(name, current);
    }
    const stock = stockRecords.map((record) => record.fields || {});
    const stockBySku = new Map(stock.map((row) => [scalar(row["货品规格ID"] ?? row["系统SKU_ID"] ?? row.sysSkuId), number(row["实际总库存"])]));
    const products = [...productMap.values()].map((item) => ({
      ...item, sales: money(item.sales), profit: money(item.profit), quantity: Math.round(item.quantity), stock: stockBySku.get(item.sku) ?? null,
    })).sort((a, b) => b.sales - a.sales).slice(0, 12);

    const selectedDeductions = deductionRecords.map((record) => record.fields || {}).filter((row) => {
      const itemDate = recordDate(row);
      return (store === "全部店铺" || scalar(row["店铺"]) === store)
        && (safeBasis === "monthly" ? itemDate.startsWith(month) : itemDate === (safeBasis === "shipped" ? yesterday : selectedDate));
    }).map((row) => ({
      date: recordDate(row), name: scalar(row["姓名"]), role: scalar(row["角色"]), store: scalar(row["店铺"]),
      type: scalar(row["类型"] || "其他"), amount: money(row["金额"]), note: scalar(row["说明"]), status: scalar(row["状态"] || "已记录"),
    }));

    const summary = {
      sales: sum(dayRows, "销售金额") || sum(dayRows, "实际收入") || sum(dayRows, "净销售额"),
      profit: sum(dayRows, "利润"), orderCount: Math.round(sum(dayRows, "订单数")), shippedCount: Math.round(sum(yesterdayRows, "实发数量")),
      refundAmount: sum(dayRows, "退款金额"), refundCount: Math.round(sum(dayRows, "退款数量")),
      misShipmentLoss: money(selectedDeductions.filter((item) => item.type.includes("错发")).reduce((total, item) => total + item.amount, 0)),
      monthProfit: sum(monthRows, "利润"), yesterdayProfit: sum(yesterdayRows, "利润"),
      teamCommission: money(commissions.reduce((total, item) => total + item.commission, 0)),
    };
    const reminders = [];
    if (!dayRows.length) reminders.push(`${selectedDate} 暂无 ERP 利润记录，请先确认当天同步是否完成。`);
    if (summary.misShipmentLoss > 0) reminders.push(`今天已登记错发损耗 ¥${summary.misShipmentLoss.toFixed(2)}，可优先核对发货环节。`);
    if (summary.refundAmount > 0) reminders.push(`ERP 今日退款金额 ¥${summary.refundAmount.toFixed(2)}，月结口径会按 ERP 最终结果体现。`);
    if (!reminders.length) reminders.push("今日暂未发现人工登记的错发损耗；经营金额均直接来自 ERP。 ");

    const value = {
      meta: {
        selectedDate, yesterday, month, latestDataDate: dates[0] || null, generatedAt: new Date().toISOString(),
        source: "快递助手 ERP → 飞书同步数据", basis: safeBasis,
        basisLabel: safeBasis === "placed" ? "下单成交（ERP 实时）" : safeBasis === "shipped" ? "昨日已发货（ERP 实时）" : "月度扣售后（ERP 实时）",
        note: `销售、利润、库存、售后均展示 ERP 返回值；${commissionSource}用于本次提成基数，系统只做比例乘法和人工扣款汇总。`,
      },
      filters: { dates: dates.slice(0, 120), stores, platforms, roles: ROLE_ORDER },
      summary, commissions, team, deductions: selectedDeductions.slice(0, 30), products, reminders,
    };
    this.cache.set(key, { time: Date.now(), value });
    return value;
  }
}
