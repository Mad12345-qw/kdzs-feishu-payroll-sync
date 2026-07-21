import { dateOnly, monthBounds, number, payrollAmount, previousMonth, roundMoney } from "./utils.js";

function value(input) {
  if (Array.isArray(input)) return input.map((item) => item?.text ?? item).join("");
  return input == null ? "" : String(input);
}

export class NewPayrollService {
  constructor({ feishu, tables, config = {} }) { this.feishu = feishu; this.tables = tables; this.config = config; }

  isPayrollConfigured(fields) {
    return value(fields?.["在职状态"]) !== "离职" && Boolean(value(fields?.["姓名"])) && Boolean(value(fields?.["所属店铺"]));
  }

  async participantCheck() {
    const people = await this.feishu.listRecords(this.tables.people.id);
    const participants = people.map((record) => record.fields || {}).filter((person) => this.isPayrollConfigured(person));
    const names = new Set(); const stores = new Set(); const errors = [];
    for (const person of participants) {
      const name = value(person["姓名"]); const store = value(person["所属店铺"]);
      if (names.has(name)) errors.push(`员工重复：${name}`); names.add(name);
      if (stores.has(store)) errors.push(`同一店铺存在多个参与结算人员：${store}`); stores.add(store);
      const salary = number(person["基本工资"]); const rate = number(person["提成百分比"]);
      if (salary < 0) errors.push(`底薪不能为负数：${name}`);
      if (rate < 0 || rate > 1) errors.push(`提成比例必须在0到1之间：${name}`);
    }
    return { people, participants, stores, errors };
  }

  async prepareMonth(month) {
    const bounds = monthBounds(month);
    const [people, payroll] = await Promise.all([
      this.feishu.listRecords(this.tables.people.id), this.feishu.listRecords(this.tables.payrollSettlement.id),
    ]);
    const existing = new Map(payroll.filter((record) => {
      const timestamp = number(record.fields?.["月份"]);
      return timestamp >= bounds.start.getTime() && timestamp <= bounds.end.getTime();
    }).map((record) => [value(record.fields?.["姓名"]), record]));
    const creates = []; const updates = []; const participantNames = new Set();
    for (const record of people) {
      const person = record.fields || {};
      if (!this.isPayrollConfigured(person)) continue;
      const name = value(person["姓名"]); const store = value(person["所属店铺"]);
      if (!name || !store) continue;
      participantNames.add(name);
      const current = existing.get(name);
      const latest = { "店铺": store, "参与结算": "是", "基本工资": number(person["基本工资"]), "提成比例": number(person["提成百分比"]) };
      if (!current) {
        creates.push({ "员工月份": `${month}|${name}`, "月份": bounds.start.getTime(), "姓名": name, ...latest,
          "绩效工资": 0, "奖金": 0, "扣款": 0, "结算状态": "待结算" });
        continue;
      }
      if (value(current.fields?.["结算状态"]) === "已结算") continue;
      const changed = value(current.fields?.["店铺"]) !== latest["店铺"]
        || value(current.fields?.["参与结算"]) !== latest["参与结算"]
        || number(current.fields?.["基本工资"]) !== latest["基本工资"]
        || number(current.fields?.["提成比例"]) !== latest["提成比例"]
        || value(current.fields?.["结算状态"]) === "不参与";
      if (changed) updates.push({ record_id: current.record_id, fields: { ...latest, "结算状态": "待结算" } });
    }
    for (const [name, current] of existing) {
      if (participantNames.has(name) || value(current.fields?.["结算状态"]) === "已结算") continue;
      if (value(current.fields?.["结算状态"]) !== "不参与" || value(current.fields?.["参与结算"]) !== "否") {
        updates.push({ record_id: current.record_id, fields: { "参与结算": "否", "结算状态": "不参与" } });
      }
    }
    if (creates.length) await this.feishu.batchCreate(this.tables.payrollSettlement.id, creates);
    if (updates.length) await this.feishu.batchUpdate(this.tables.payrollSettlement.id, updates);
    return { month, created: creates.length, updated: updates.length };
  }

  async writeBatch(fields) {
    return this.feishu.upsert(this.tables.batches.id, [{ "同步唯一键": fields["批次编号"], ...fields }], {
      legacyKey: (record) => record["批次编号"],
    });
  }

  async settlePreviousMonth({ now = new Date(), settlementDay = 15, force = false } = {}) {
    const day = Number(new Intl.DateTimeFormat("en", { timeZone: "Asia/Shanghai", day: "2-digit" }).format(now));
    if (!force && day < settlementDay) return { skipped: true, reason: `每月${settlementDay}日后结算` };
    const month = previousMonth(now); const bounds = monthBounds(month);
    await this.prepareMonth(month);
    const check = await this.participantCheck();
    const [profitRows, payrollRows, reconciliationRows] = await Promise.all([
      this.feishu.listRecords(this.tables.storeProfit.id), this.feishu.listRecords(this.tables.payrollSettlement.id),
      this.feishu.listRecords(this.tables.reconciliation.id),
    ]);
    const reconciliationByStore = new Map(reconciliationRows.filter((record) => value(record.fields?.["月份"]) === month)
      .map((record) => [value(record.fields?.["店铺"]), record.fields || {}]));
    const gateErrors = [...check.errors];
    for (const person of check.participants) {
      const store = value(person["所属店铺"]); const row = reconciliationByStore.get(store);
      if (!row || value(row["对账状态"]) !== "通过") gateErrors.push(`店铺未通过月度利润对账：${store}`);
    }
    const batchId = `${month}|${now.toISOString()}`;
    if (gateErrors.length) {
      await this.writeBatch({ "批次编号": batchId, "月份": month, "结算日": now.getTime(), "状态": "已阻断",
        "员工数": check.participants.length, "对账结果": "不通过", "阻断原因": gateErrors.join("；").slice(0, 500) });
      return { skipped: true, blocked: true, month, reason: gateErrors.join("；"), settled: [] };
    }
    const profit = new Map();
    const daily = new Map();
    for (const record of profitRows) {
      const fields = record.fields || {}; const timestamp = number(fields["统计日期"]);
      if (timestamp < bounds.start.getTime() || timestamp > bounds.end.getTime()) continue;
      const key = `${value(fields["平台"])}|${value(fields["店铺名称"])}|${dateOnly(new Date(timestamp))}`;
      const previous = daily.get(key);
      const hasSyncKey = Boolean(value(fields["同步唯一键"]));
      const previousHasSyncKey = Boolean(value(previous?.["同步唯一键"]));
      if (previous && !hasSyncKey && previousHasSyncKey) continue;
      if (previous && number(fields["同步时间"]) <= number(previous["同步时间"])) continue;
      daily.set(key, fields);
      const store = value(fields["店铺名称"]); profit.set(store, number(profit.get(store)) + number(fields["利润"]));
    }
    const updates = []; const settled = [];
    for (const record of payrollRows) {
      const fields = record.fields || {}; const timestamp = number(fields["月份"]);
      if (timestamp < bounds.start.getTime() || timestamp > bounds.end.getTime() || value(fields["结算状态"]) === "已结算"
        || value(fields["参与结算"]) !== "是") continue;
      const storeProfit = roundMoney(profit.get(value(fields["店铺"])) || 0);
      const commission = roundMoney(Math.max(0, storeProfit) * number(fields["提成比例"]));
      const payable = payrollAmount({ baseSalary: fields["基本工资"], performance: fields["绩效工资"], bonus: fields["奖金"],
        storeProfit, commissionRate: fields["提成比例"], deduction: fields["扣款"] });
      updates.push({ record_id: record.record_id, fields: { "参与结算": "是", "店铺利润": storeProfit, "提成金额": commission,
        "应发工资": payable, "实发工资": payable, "结算状态": "已结算", "结算时间": now.getTime() } });
      settled.push({ name: value(fields["姓名"]), store: value(fields["店铺"]), storeProfit, commission, payable });
    }
    if (updates.length) await this.feishu.batchUpdate(this.tables.payrollSettlement.id, updates);
    const total = roundMoney(settled.reduce((sum, row) => sum + row.payable, 0));
    await this.writeBatch({ "批次编号": batchId, "月份": month, "结算日": now.getTime(), "状态": "已完成",
      "员工数": settled.length, "工资合计": total, "对账结果": "通过" });
    return { skipped: false, month, updated: updates.length, settled, total };
  }

  async refreshPerformance(month) {
    const bounds = monthBounds(month);
    const [check, profitRows, payrollRows] = await Promise.all([
      this.participantCheck(), this.feishu.listRecords(this.tables.storeProfit.id), this.feishu.listRecords(this.tables.payrollSettlement.id),
    ]);
    const daily = new Map();
    for (const record of profitRows) {
      const fields = record.fields || {}; const timestamp = number(fields["统计日期"]);
      if (timestamp < bounds.start.getTime() || timestamp > bounds.end.getTime()) continue;
      const key = `${value(fields["平台"])}|${value(fields["店铺名称"])}|${dateOnly(new Date(timestamp))}`;
      const previous = daily.get(key); const hasSyncKey = Boolean(value(fields["同步唯一键"]));
      if (!previous || (hasSyncKey && !value(previous["同步唯一键"])) || number(fields["同步时间"]) > number(previous["同步时间"])) daily.set(key, fields);
    }
    const summary = new Map();
    for (const fields of daily.values()) {
      const store = value(fields["店铺名称"]); const current = summary.get(store) || { gmv: 0, refund: 0, net: 0, cost: 0, freight: 0, profit: 0 };
      current.gmv += number(fields["销售金额"]); current.refund += number(fields["退款金额"]); current.net += number(fields["净销售额"]);
      current.cost += number(fields["成本费用"]); current.freight += number(fields["运费成本"]); current.profit += number(fields["利润"]); summary.set(store, current);
    }
    const rows = [];
    for (const person of check.participants) {
      const name = value(person["姓名"]); const store = value(person["所属店铺"]); const s = summary.get(store) || { gmv: 0, refund: 0, net: 0, cost: 0, freight: 0, profit: 0 };
      const payroll = payrollRows.find((record) => value(record.fields?.["姓名"]) === name && number(record.fields?.["月份"]) === bounds.start.getTime())?.fields || {};
      const profit = roundMoney(s.profit); const commission = roundMoney(Math.max(0, profit) * number(person["提成百分比"]));
      rows.push({ "同步唯一键": `${month}|${name}`, "员工月份": `${month}|${name}`, "月份": month, "姓名": name, "店铺": store,
        "GMV": roundMoney(s.gmv), "退款金额": roundMoney(s.refund), "实收金额": roundMoney(s.net), "商品成本": roundMoney(s.cost - s.freight),
        "运费": roundMoney(s.freight), "毛利": roundMoney(s.net - s.cost), "净利润": profit, "利润率": s.net ? profit / s.net : 0,
        "提成比例": number(person["提成百分比"]), "提成金额": commission, "底薪": number(person["基本工资"]),
        "绩效工资": number(payroll["绩效工资"]), "奖金": number(payroll["奖金"]), "扣款": number(payroll["扣款"]),
        "应发工资": number(payroll["应发工资"]), "状态": value(payroll["结算状态"]) || "待结算" });
    }
    return this.feishu.upsert(this.tables.performance.id, rows, (fields) => fields["同步唯一键"]);
  }
}
