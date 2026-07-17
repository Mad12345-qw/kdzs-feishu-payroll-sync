import fs from "node:fs";
import path from "node:path";

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function compactObject(input) {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined && value !== null && value !== ""));
}

export function text(value) {
  return value === undefined || value === null ? "" : String(value);
}

export function number(value, fallback = 0) {
  const result = Number(value);
  return Number.isFinite(result) ? result : fallback;
}

export function roundMoney(value) {
  return Math.round((number(value) + Number.EPSILON) * 100) / 100;
}

export function payrollAmount({ baseSalary, performance = 0, bonus = 0, storeProfit = 0, commissionRate = 0, deduction = 0 }) {
  return roundMoney(number(baseSalary) + number(performance) + number(bonus) + Math.max(0, number(storeProfit)) * number(commissionRate) - number(deduction));
}

export function formatChinaDateTime(date = new Date()) {
  const parts = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(date);
  const get = (type) => parts.find((part) => part.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}:${get("second")}`;
}

export function dateOnly(date = new Date()) {
  return formatChinaDateTime(date).slice(0, 10);
}

export function parseLocalDate(value) {
  return new Date(`${value.slice(0, 10)}T00:00:00+08:00`);
}

export function addDays(date, days) {
  return new Date(date.getTime() + days * 86400000);
}

export function startOfDayString(date) {
  return `${dateOnly(date)} 00:00:00`;
}

export function endOfDayString(date) {
  return `${dateOnly(date)} 23:59:59`;
}

export function monthBounds(month) {
  const [year, monthNumber] = month.split("-").map(Number);
  const start = parseLocalDate(`${month}-01`);
  const nextYear = monthNumber === 12 ? year + 1 : year;
  const nextMonth = monthNumber === 12 ? 1 : monthNumber + 1;
  const end = new Date(parseLocalDate(`${nextYear}-${String(nextMonth).padStart(2, "0")}-01`).getTime() - 1000);
  return { start, end };
}

export function previousMonth(date = new Date()) {
  const [year, month] = dateOnly(date).split("-").map(Number);
  const current = new Date(Date.UTC(year, month - 1, 1));
  current.setUTCMonth(current.getUTCMonth() - 1);
  return `${current.getUTCFullYear()}-${String(current.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function dateChunks(start, end, maxDays) {
  const chunks = [];
  let cursor = new Date(start);
  while (cursor <= end) {
    const chunkEnd = new Date(Math.min(addDays(cursor, maxDays - 1).getTime(), end.getTime()));
    chunks.push([new Date(cursor), chunkEnd]);
    cursor = addDays(chunkEnd, 1);
  }
  return chunks;
}

export function uniqueBy(items, keyFn, merge = (_, next) => next) {
  const map = new Map();
  for (const item of items) {
    const key = keyFn(item);
    if (!key) continue;
    map.set(key, map.has(key) ? merge(map.get(key), item) : item);
  }
  return [...map.values()];
}

export function writeJsonLog(name, payload) {
  const dir = path.resolve(process.cwd(), "logs");
  fs.mkdirSync(dir, { recursive: true });
  const safeTime = new Date().toISOString().replace(/[:.]/g, "-");
  const file = path.join(dir, `${safeTime}-${name}.json`);
  fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return file;
}

export async function retry(fn, { attempts = 5, baseMs = 500, shouldRetry = () => true } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try { return await fn(attempt); } catch (error) {
      lastError = error;
      if (attempt === attempts || !shouldRetry(error)) throw error;
      await sleep(baseMs * 2 ** (attempt - 1) + Math.floor(Math.random() * 200));
    }
  }
  throw lastError;
}
