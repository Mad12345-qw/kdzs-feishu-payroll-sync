import { TABLES } from "./tables.js";
import { dateOnly, monthBounds, number, payrollAmount, previousMonth, roundMoney, text } from "./utils.js";

export const PAYROLL_FIELDS = {
  settlementStatus: "结算状态",
  settlementAt: "结算时间",
  profitSnapshot: "店铺利润快照",
  commissionSnapshot: "提成金额快照",
};

function fieldText(value) {
  if (Array.isArray(value)) return value.map((part) => part?.text ?? part).join("");
  return text(value);
}

export async function ensurePayrollFields(feishu) {
  const table = TABLES.payroll.id;
  const status = await feishu.ensureField(table, PAYROLL_FIELDS.settlementStatus, 3, {
    options: [{ name: "待结算", color: 1 }, { name: "已结算", color: 3 }],
  });
  await feishu.ensureField(table, PAYROLL_FIELDS.settlementAt, 5, { date_formatter: "yyyy-MM-dd HH:mm" });
  const profitSnapshot = await feishu.ensureField(table, PAYROLL_FIELDS.profitSnapshot, 2, { formatter: "0.00", currency_code: "CNY" });
  await feishu.ensureField(table, PAYROLL_FIELDS.commissionSnapshot, 2, { formatter: "0.00", currency_code: "CNY" });
  const fields = await feishu.listFields(table);
  const byName = new Map(fields.map((field) => [field.field_name, field]));
  const required = ["基本工资", "绩效工资", "奖金", "所在店铺当月利润和", "提成百分比", "扣款", "应发工资"];
  if (required.every((name) => byName.has(name)) && status?.field_id && profitSnapshot?.field_id) {
    const ref = (name) => `bitable::$table[${table}].$field[${byName.get(name).field_id}]`;
    const expression = `ROUND(${ref("基本工资")}+${ref("绩效工资")}+${ref("奖金")}+MAX(0,IF(bitable::$table[${table}].$field[${status.field_id}]=\"已结算\",bitable::$table[${table}].$field[${profitSnapshot.field_id}],${ref("所在店铺当月利润和")}))*${ref("提成百分比")}-${ref("扣款")},2)`;
    const payableField = byName.get("应发工资");
    if (payableField.property?.formula_expression !== expression) {
      await feishu.updateField(table, payableField.field_id, {
        field_name: "应发工资", type: 20,
        property: { formatter: "0.00", formula_expression: expression },
      });
    }
  }
}

export async function preparePayrollMonth(feishu, now = new Date()) {
  await ensurePayrollFields(feishu);
  const currentMonth = dateOnly(now).slice(0, 7);
  const { start, end } = monthBounds(currentMonth);
  const [people, payrollRows] = await Promise.all([
    feishu.listRecords(TABLES.people.id), feishu.listRecords(TABLES.payroll.id),
  ]);
  const existingNames = new Set(payrollRows.filter((record) => {
    const timestamp = number(record.fields?.["月份"]);
    return timestamp >= start.getTime() && timestamp <= end.getTime();
  }).map((record) => fieldText(record.fields?.["姓名"])));
  const creates = people.map((record) => fieldText(record.fields?.["姓名"]))
    .filter((name) => name && !existingNames.has(name))
    .map((name) => ({
      "姓名": name, "月份": start.getTime(), "绩效工资": 0, "奖金": 0, "扣款": 0,
      [PAYROLL_FIELDS.settlementStatus]: "待结算",
    }));
  if (creates.length) await feishu.batchCreate(TABLES.payroll.id, creates);
  return { month: currentMonth, created: creates.length };
}

export async function settlePreviousMonth(feishu, { settlementDay = 15, now = new Date(), force = false } = {}) {
  const today = Number(dateOnly(now).slice(-2));
  if (!force && today < settlementDay) return { skipped: true, reason: `每月 ${settlementDay} 日后才结算上月工资` };
  await ensurePayrollFields(feishu);
  const month = previousMonth(now);
  const { start, end } = monthBounds(month);
  const monthTimestamp = start.getTime();
  const people = await feishu.listRecords(TABLES.people.id);
  const profitRows = await feishu.listRecords(TABLES.storeProfit.id);
  const payrollRows = await feishu.listRecords(TABLES.payroll.id);

  const profitByStore = new Map();
  for (const record of profitRows) {
    const timestamp = number(record.fields?.["日期"], NaN);
    if (!Number.isFinite(timestamp) || timestamp < start.getTime() || timestamp > end.getTime()) continue;
    const store = fieldText(record.fields?.["店铺名称"]);
    profitByStore.set(store, number(profitByStore.get(store)) + number(record.fields?.["利润"]));
  }

  const existing = new Map();
  for (const record of payrollRows) {
    const name = fieldText(record.fields?.["姓名"]);
    const rowMonth = number(record.fields?.["月份"]);
    if (name && rowMonth >= start.getTime() && rowMonth <= end.getTime()) existing.set(name, record);
  }

  const creates = [];
  const updates = [];
  const settled = [];
  for (const personRecord of people) {
    const person = personRecord.fields || {};
    const name = fieldText(person["姓名"]);
    const store = fieldText(person["所属店铺"]);
    if (!name || !store) continue;
    const profit = roundMoney(profitByStore.get(store) || 0);
    const rate = number(person["提成百分比"]);
    const current = existing.get(name);
    if (current?.fields?.[PAYROLL_FIELDS.settlementStatus] === "已结算") continue;
    const performance = number(current?.fields?.["绩效工资"]);
    const bonus = number(current?.fields?.["奖金"]);
    const deduction = number(current?.fields?.["扣款"]);
    const baseSalary = number(person["基本工资"]);
    const commission = roundMoney(Math.max(0, profit) * rate);
    const payable = payrollAmount({ baseSalary, performance, bonus, storeProfit: profit, commissionRate: rate, deduction });
    const fields = {
      "姓名": name, "月份": monthTimestamp, "绩效工资": performance, "奖金": bonus, "扣款": deduction,
      "实发工资": payable, [PAYROLL_FIELDS.settlementStatus]: "已结算", [PAYROLL_FIELDS.settlementAt]: now.getTime(),
      [PAYROLL_FIELDS.profitSnapshot]: profit, [PAYROLL_FIELDS.commissionSnapshot]: commission,
    };
    if (current) updates.push({ record_id: current.record_id, fields }); else creates.push(fields);
    settled.push({ name, store, profit, rate, commission, payable });
  }
  if (creates.length) await feishu.batchCreate(TABLES.payroll.id, creates);
  if (updates.length) await feishu.batchUpdate(TABLES.payroll.id, updates);
  return { skipped: false, month, created: creates.length, updated: updates.length, settled };
}
