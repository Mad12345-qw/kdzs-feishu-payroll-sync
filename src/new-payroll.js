import { monthBounds, number, payrollAmount, previousMonth, roundMoney } from "./utils.js";

function value(input) {
  if (Array.isArray(input)) return input.map((item) => item?.text ?? item).join("");
  return input == null ? "" : String(input);
}

export class NewPayrollService {
  constructor({ feishu, tables }) { this.feishu = feishu; this.tables = tables; }

  async prepareMonth(month) {
    const bounds = monthBounds(month);
    const [people, payroll] = await Promise.all([
      this.feishu.listRecords(this.tables.people.id), this.feishu.listRecords(this.tables.payrollSettlement.id),
    ]);
    const existing = new Set(payroll.filter((record) => {
      const timestamp = number(record.fields?.["月份"]);
      return timestamp >= bounds.start.getTime() && timestamp <= bounds.end.getTime();
    }).map((record) => value(record.fields?.["姓名"])));
    const rows = people.filter((record) => value(record.fields?.["在职状态"]) !== "离职").map((record) => record.fields || {})
      .filter((person) => person["姓名"] && person["所属店铺"] && !existing.has(value(person["姓名"])))
      .map((person) => ({
        "员工月份": `${month}|${value(person["姓名"])}`, "月份": bounds.start.getTime(), "姓名": value(person["姓名"]),
        "店铺": value(person["所属店铺"]), "基本工资": number(person["基本工资"]), "提成比例": number(person["提成百分比"]),
        "绩效工资": 0, "奖金": 0, "扣款": 0, "结算状态": "待结算",
      }));
    if (rows.length) await this.feishu.batchCreate(this.tables.payrollSettlement.id, rows);
    return { month, created: rows.length };
  }

  async settlePreviousMonth({ now = new Date(), settlementDay = 15, force = false } = {}) {
    const day = Number(new Intl.DateTimeFormat("en", { timeZone: "Asia/Shanghai", day: "2-digit" }).format(now));
    if (!force && day < settlementDay) return { skipped: true, reason: `每月${settlementDay}日后结算` };
    const month = previousMonth(now); const bounds = monthBounds(month);
    await this.prepareMonth(month);
    const [profitRows, payrollRows] = await Promise.all([
      this.feishu.listRecords(this.tables.storeProfit.id), this.feishu.listRecords(this.tables.payrollSettlement.id),
    ]);
    const profit = new Map();
    for (const record of profitRows) {
      const timestamp = number(record.fields?.["统计日期"]);
      if (timestamp < bounds.start.getTime() || timestamp > bounds.end.getTime()) continue;
      const store = value(record.fields?.["店铺名称"]);
      profit.set(store, number(profit.get(store)) + number(record.fields?.["利润"]));
    }
    const updates = []; const settled = [];
    for (const record of payrollRows) {
      const fields = record.fields || {}; const timestamp = number(fields["月份"]);
      if (timestamp < bounds.start.getTime() || timestamp > bounds.end.getTime() || value(fields["结算状态"]) === "已结算") continue;
      const storeProfit = roundMoney(profit.get(value(fields["店铺"])) || 0);
      const commission = roundMoney(Math.max(0, storeProfit) * number(fields["提成比例"]));
      const payable = payrollAmount({
        baseSalary: fields["基本工资"], performance: fields["绩效工资"], bonus: fields["奖金"],
        storeProfit, commissionRate: fields["提成比例"], deduction: fields["扣款"],
      });
      updates.push({ record_id: record.record_id, fields: {
        "店铺利润": storeProfit, "提成金额": commission, "应发工资": payable, "实发工资": payable,
        "结算状态": "已结算", "结算时间": now.getTime(),
      } });
      settled.push({ name: value(fields["姓名"]), store: value(fields["店铺"]), storeProfit, commission, payable });
    }
    if (updates.length) await this.feishu.batchUpdate(this.tables.payrollSettlement.id, updates);
    return { skipped: false, month, updated: updates.length, settled };
  }
}
