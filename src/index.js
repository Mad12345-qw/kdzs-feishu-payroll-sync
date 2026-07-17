import { getConfig } from "./config.js";
import { FeishuClient } from "./feishu-client.js";
import { KdzsClient } from "./kdzs-client.js";
import { preparePayrollMonth, settlePreviousMonth } from "./payroll.js";
import { SyncService } from "./sync-service.js";

const command = process.argv[2] || "sync";
const requireKdzs = ["sync", "check"].includes(command);

try {
  const config = getConfig({ requireKdzs });
  const feishu = new FeishuClient(config.feishu);
  const kdzs = requireKdzs ? new KdzsClient(config.kdzs) : null;
  const service = new SyncService({ kdzs, feishu, config });
  let result;
  if (command === "migrate") result = await service.migrate();
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
