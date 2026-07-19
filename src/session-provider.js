import { KdzsClient } from "./kdzs-client.js";

function scalar(value) {
  if (Array.isArray(value)) {
    return value.map((item) => item?.text ?? item).join("");
  }
  return value == null ? "" : String(value);
}

export async function createKdzsFromSessionTable(feishu, config) {
  const tableId = config.runtime.sessionTableId;
  const records = await feishu.listRecords(tableId);
  const record = records[0];
  if (!record) throw new Error("系统-session 表没有配置记录");
  const fields = record.fields || {};
  const appKey = scalar(fields.appKey);
  const appSecret = scalar(fields.secret);
  const session = scalar(fields.session);
  if (!appKey || !appSecret) throw new Error("系统-session 缺少 appKey 或 secret");

  return new KdzsClient({
    appKey,
    appSecret,
    session,
    gateway: config.kdzs.gateway,
    tokenUrl: config.kdzs.tokenUrl,
    onSessionRefresh: async ({ accessToken, expireTimeStamp, response }) => {
      if (expireTimeStamp) await feishu.ensureField(tableId, "过期时间", 5, { date_formatter: "yyyy/MM/dd HH:mm" });
      await feishu.batchUpdate(tableId, [{
        record_id: record.record_id,
        fields: {
          session: accessToken,
          "更新时间": Date.now(),
          "更新状态": "已更新",
          "返回信息": JSON.stringify(response),
          ...(expireTimeStamp ? { "过期时间": Number(expireTimeStamp) } : {}),
        },
      }]);
    },
  });
}

// Production deployments should keep ERP credentials in the host's secret
// store. The Feishu session table remains only as a backward-compatible path.
export async function createDeliveryKdzsClient({ feishu, config }) {
  if (config.kdzs.appKey && config.kdzs.appSecret) {
    return new KdzsClient({
      appKey: config.kdzs.appKey,
      appSecret: config.kdzs.appSecret,
      session: config.kdzs.session,
      gateway: config.kdzs.gateway,
      tokenUrl: config.kdzs.tokenUrl,
    });
  }
  if (!feishu) throw new Error("缺少 ERP 凭证：请配置 Render 的 KDZS_APP_KEY / KDZS_APP_SECRET");
  return createKdzsFromSessionTable(feishu, config);
}
