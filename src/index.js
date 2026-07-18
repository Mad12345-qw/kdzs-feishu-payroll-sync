import { getConfig } from "./config.js";
import { FeishuClient } from "./feishu-client.js";
import { KdzsClient } from "./kdzs-client.js";
import { preparePayrollMonth, settlePreviousMonth } from "./payroll.js";
import { SyncService } from "./sync-service.js";
import { createKdzsFromSessionTable } from "./session-provider.js";
import { NewBaseSyncService } from "./new-base-sync.js";
import { NewPayrollService } from "./new-payroll.js";
import { previousMonth } from "./utils.js";
import { DeliverySyncService } from "./delivery-sync.js";

const command = process.argv[2] || "sync";
const requireKdzs = ["sync", "check"].includes(command);

try {
  const config = getConfig({ requireKdzs });
  const feishu = new FeishuClient(config.feishu);
  const sourceFeishu = new FeishuClient({ ...config.feishu, baseToken: config.feishu.sourceBaseToken });
  const kdzs = requireKdzs ? new KdzsClient(config.kdzs) : null;
  const service = new SyncService({ kdzs, feishu, config });
  let result;
  if (["delivery-backfill", "delivery-backfill-logistics", "delivery-backfill-profit", "delivery-reference", "delivery-sync-day", "delivery-prepare-payroll", "delivery-settle-payroll", "delivery-reconcile"].includes(command)) {
    const sessionClient = await createKdzsFromSessionTable(sourceFeishu, config);
    const delivery = new DeliverySyncService({ feishu, kdzs: sessionClient });
    if (command === "delivery-sync-day") {
      const day = process.argv.find((arg) => arg.startsWith("--day="))?.slice(6) || new Date().toISOString().slice(0, 10);
      result = await delivery.syncDay(day);
    } else if (command === "delivery-reference") {
      result = await delivery.syncReferenceData();
    } else if (["delivery-backfill", "delivery-backfill-logistics", "delivery-backfill-profit"].includes(command)) {
      const startDate = process.argv.find((arg) => arg.startsWith("--start="))?.slice(8);
      const endDate = process.argv.find((arg) => arg.startsWith("--end="))?.slice(6);
      if (!startDate || !endDate) throw new Error("delivery-backfill 必须指定 --start 和 --end");
      result = command === "delivery-backfill-logistics" ? await delivery.backfillLogistics({ startDate, endDate })
        : command === "delivery-backfill-profit" ? await delivery.backfillStoreProfit({ startDate, endDate })
          : await delivery.backfill({ startDate, endDate });
    } else {
      const month = process.argv.find((arg) => arg.startsWith("--month="))?.slice(8) || previousMonth(new Date());
      if (command === "delivery-prepare-payroll") result = await delivery.preparePayroll(month);
      else if (command === "delivery-settle-payroll") result = await delivery.settlePayroll(month);
      else result = await delivery.reconcileMonth(month);
    }
  }
  else if (["new-migrate", "new-sync", "new-daily", "new-payroll", "new-profit", "new-backfill", "new-archive", "new-release-orders"].includes(command)) {
    const sessionClient = await createKdzsFromSessionTable(sourceFeishu, config);
    const newService = new NewBaseSyncService({ feishu, kdzs: sessionClient, config });
    if (command === "new-migrate") result = await newService.migrate();
    else if (command === "new-sync") result = await newService.executeLogged("小时同步", () => newService.syncOperational());
    else if (command === "new-daily") result = await newService.executeLogged("日同步", () => newService.syncDaily());
    else if (command === "new-profit") result = await newService.executeLogged("利润同步", () => newService.syncProfit());
    else if (command === "new-archive") result = await newService.executeLogged("历史归档", () => newService.archiveOperationalHistory({ retentionDays: 14 }));
    else if (command === "new-release-orders") result = await newService.executeLogged("订单归档释放", () => newService.releaseArchivedOrders({ retentionDays: 14 }));
    else if (command === "new-backfill") {
      const start = process.argv.find((arg) => arg.startsWith("--start="))?.slice(8) || config.sync.startDate;
      const end = process.argv.find((arg) => arg.startsWith("--end="))?.slice(6) || undefined;
      result = await newService.executeLogged("历史全量回填", () => newService.syncBackfill({ startDate: start, endDate: end || undefined }));
    }
    else {
      const tables = await newService.migrate();
      const payrollService = new NewPayrollService({ feishu, tables, config });
      const now = new Date();
      const parts = new Intl.DateTimeFormat("en", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit" }).formatToParts(now);
      const getPart = (type) => parts.find((part) => part.type === type)?.value;
      const draft = await payrollService.prepareMonth(`${getPart("year")}-${getPart("month")}`);
      const settlement = await payrollService.settlePreviousMonth({
        settlementDay: config.sync.payrollSettlementDay, force: process.argv.includes("--force"),
      });
      result = { draft, settlement };
    }
  }
  else if (command === "migrate") result = await service.migrate();
  else if (command === "payroll") {
    const draft = await preparePayrollMonth(feishu);
    const settlement = await settlePreviousMonth(feishu, {
      settlementDay: config.sync.payrollSettlementDay, force: process.argv.includes("--force"),
    });
    result = { draft, settlement };
  }
  else if (command === "check") {
    const [stockSample, fields] = await Promise.all([
      kdzs.call("kdzs.erp.api.stock.list", { pageNo: 1, pageSize: 1 }),
      feishu.listFields("tbl4bNkg9qYtHRnx"),
    ]);
    result = {
      kdzs: stockSample?.success !== false,
      kdzsGatewayAndSignatureVerified: true,
      sampleStockRows: stockSample?.list?.length || 0,
      feishu: fields.length > 0,
      orderFieldCount: fields.length,
    };
  } else if (command === "sync") result = await service.syncAll({ full: process.argv.includes("--full") });
  else throw new Error(`未知命令：${command}`);
  console.log(JSON.stringify(result, null, 2));
  if (result?.results && Object.values(result.results).some((item) => item?.failed)) process.exitCode = 1;
} catch (error) {
  console.error(JSON.stringify({ success: false, error: error.message, details: error.response }, null, 2));
  process.exitCode = 1;
}
