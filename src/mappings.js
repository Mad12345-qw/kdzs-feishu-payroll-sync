import { number, text, uniqueBy } from "./utils.js";

export function mapOrders(trades) {
  const rows = [];
  for (const trade of trades) {
    for (const order of trade.orderList || []) {
      const key = `${text(trade.tid)}|${text(order.oid || order.ptOid)}`;
      rows.push({
        "同步唯一键": key,
        "店铺名称": text(trade.sellerNick), "创建时间": text(trade.created), "退款状态": text(trade.refundStatus),
        "来源": text(trade.source), "平台订单号": text(trade.ptTid), "receivedPayment": text(trade.receivedPayment),
        "收件城市": text(trade.receiverCity), "平台类型": text(trade.platform), "tid": text(trade.tid),
        "发货时间": text(trade.sysShipTime), "卖家ID": text(trade.sellerId), "卖家标记": number(trade.sellerFlag),
        "收件区县": text(trade.receiverDistrict), "收件省份": text(trade.receiverState), "修改时间": text(trade.modified),
        "支付金额": number(trade.payment), "平台描述": text(trade.platformDesc), "订单状态": text(trade.status),
        "已收金额": number(trade.receivedPayment), "平台子订单号": text(order.ptOid), "商品ID": text(order.numiid),
        "系统商品ID": text(order.sysItemId), "item_refundStatus": text(order.refundStatus), "系统SKU图片": text(order.sysSkuUrl),
        "子订单ID": text(order.oid), "商品名称": text(order.title), "SKU属性": text(order.skuProperties),
        "系统SKU_ID": text(order.sysSkuId), "数量": number(order.number), "系统SKU名称": text(order.sysSkuName),
        "SKU_ID": text(order.skuId), "子订单状态": text(order.status), "最后发货时间": text(trade.lastShipTime),
        "商品编码": text(order.outerId), "item_skuOuterId": text(order.skuOuterId),
        "卖家备注": text(trade.sellerMemo), "买家留言": text(trade.buyerMessage), "SKU编码": text(order.sysOuterSkuId),
      });
    }
  }
  return uniqueBy(rows, (row) => row["同步唯一键"]);
}

export function mapRefunds(refunds) {
  const rows = [];
  for (const refund of refunds) {
    const grouped = uniqueBy((refund.items || [{}]).map((item) => ({ ...item })),
      (item) => `${text(item.outerSkuId)}|${text(item.title)}|${text(item.skuProperties)}`,
      (previous, next) => ({ ...next, refundNum: number(previous.refundNum) + number(next.refundNum), refundAmount: number(previous.refundAmount) + number(next.refundAmount) }));
    for (const item of grouped) {
      const itemKey = `${text(item.outerSkuId)}|${text(item.title)}|${text(item.skuProperties)}`;
      rows.push({
        "同步唯一键": `${text(refund.refundId)}|${itemKey}`,
        "买家昵称": text(refund.buyerNick), "退款状态": text(refund.refundStatusDesc), "平台订单号": text(refund.ptTid),
        "平台类型": text(refund.platform), "订单编号": text(refund.tid), "售后更新时间": text(refund.refundModifiedTime),
        "店铺ID": text(refund.sellerId), "买家旗帜": number(refund.sellerFlag), "退款金额": number(refund.refundAmount),
        "买家申请时间": text(refund.refundCreatedTime), "售后类型": text(refund.afterSaleType), "店铺名称": text(refund.sellerNick),
        "售后原因": text(refund.refundReason), "货物状态说明": text(refund.goodsStatusDesc), "货物状态": text(refund.goodsStatusDesc),
        "退款状态说明": text(refund.refundStatusDesc), "退款编号": text(refund.refundId), "售后数量": number(item.refundNum),
        "规格名称": text(item.skuProperties), "商家规格编码": text(item.outerSkuId), "商家编码": text(item.outerId),
        "商品标题": text(item.title), "商品退款金额": number(item.refundAmount), "卖方备注": text(refund.sellerMemo),
        "线下备注": text(refund.localContent), "物流公司编码": text(refund.logisticsCode), "物流公司名称": text(refund.logisticsName),
        "退货物流单号": text(refund.returnLogisticsNo),
      });
    }
  }
  return uniqueBy(rows, (row) => row["同步唯一键"]);
}

export function mapPlatformItems(items) {
  const rows = [];
  for (const item of items) for (const sku of item.platformItemSkuList || [{}]) {
    rows.push({
      "同步唯一键": `${text(item.numIid)}|${text(sku.skuId || "NO_SKU")}`,
      "审核状态": text(item.approveStatus), "商品图片": text(item.itemPicUrl), "商品ID": text(item.numIid),
      "商品标题": text(item.title), "SKU名称": text(sku.skuName), "SKU创建时间": text(sku.itemSkuCreateTime),
      "SKU图片": text(sku.picUrl), "SKU价格": number(sku.price), "SKU_ID": text(sku.skuId),
      "SKU编码": text(sku.skuOuterId), "品种编码": text(item.varietyOuterId), "外部编码": text(item.outerId),
    });
  }
  return uniqueBy(rows, (row) => row["同步唯一键"]);
}

export function mapErpItems(items) {
  const rows = [];
  for (const item of items) for (const sku of item.skuList || [{}]) {
    rows.push({
      "同步唯一键": `${text(item.sysItemId)}|${text(sku.sysSkuId || "NO_SKU")}`,
      "创建时间": text(item.created), "分类ID": text(item.classifyId), "系统商品ID": text(item.sysItemId),
      "属性": text(item.property), "修改时间": text(item.modified), "商品名称": text(item.sysItemName),
      "分类名称": text(item.classifyName), "SKU创建时间": text(sku.created), "成本价": number(sku.costPrice),
      "重量": number(sku.weight), "条形码": text(sku.barCode), "系统SKU_ID": text(sku.sysSkuId),
      "价格": number(sku.price), "SKU修改时间": text(sku.modified), "SKU外部编码": text(sku.skuOuterId),
      "SKU名称": text(sku.sysSkuName), "外部编码": text(item.outerId), "货位": text(sku.warehouseSlotName),
      "尺码": text(sku.sysSize), "SKU编码": text(sku.sysSkuAlias), "商品编号": text(sku.itemNo), "颜色": text(sku.sysColor),
    });
  }
  return uniqueBy(rows, (row) => row["同步唯一键"]);
}

export function mapStock(items) {
  return uniqueBy(items.map((item) => ({
    "同步唯一键": text(item.sysSkuId), "可配货库存": number(item.salableItemDistributableStock),
    "退货待处理": number(item.refundStockWaitHandNum), "预占数量": number(item.salableItemPreemptedNum),
    "系统商品ID": text(item.sysItemId), "条形码": text(item.barCode), "系统SKU_ID": text(item.sysSkuId),
    "总库存": number(item.stockTotal), "商品名称": text(item.sysItemAlias), "在途库存": number(item.transitItemStock),
    "SKU名称": text(item.sysSkuName), "SKU编码": text(item.sysSkuAlias), "商品编号": text(item.itemNo),
  })), (row) => row["同步唯一键"]);
}

export function mapStoreProfit(items, day) {
  return uniqueBy(items.map((item) => ({
    "同步唯一键": `${day}|${platformDesc(item.platform)}|${text(item.sellerNick)}`,
    "发货前退货金额": number(item.beforeRefundAmount), "退款数量": number(item.hasRefundNum || item.refundNum),
    "利润": number(item.netSalesProfit), "实发数量": number(item.actualNumber), "number": number(item.number),
    "netSalesProfitMargin": number(item.netSalesProfitMargin), "净销量": number(item.netSalesNum),
    "对应平台订单数量": number(item.ptTidCount), "退货成本": number(item.refundCost), "运费成本": number(item.postCost),
    "实际货品成本": number(item.actualCost), "销售成本": number(item.paymentCost), "净销售额": number(item.netSales),
    "销售毛利率": number(item.paymentProfitMargin), "销售均价": number(item.paymentAverage), "订单数": number(item.tidCount),
    "实际收入": number(item.income), "实退数量": number(item.refundNum), "平台类型": platformDesc(item.platform),
    "发货后退款金额": number(item.afterRefundAmount), "商品数量": number(item.itemNum), "退货毛利": number(item.refundProfit),
    "利润率": number(item.netSalesProfitMargin), "退款金额": number(item.refundAmount), "实发商品成本": number(item.costPrice),
    "refundAmount": number(item.refundAmount), "店铺名称": text(item.sellerNick), "SKU_ID": text(item.skuId),
    "邮费": number(item.postFee), "成本费用": number(item.costPrice) + number(item.postCost),
    "销售毛利": number(item.paymentProfit), "日期": Date.parse(`${day}T00:00:00+08:00`),
  })), (row) => row["同步唯一键"]);
}

function platformDesc(value) {
  return ({ fxg: "抖音", ksxd: "快手", xygj: "闲鱼管家" })[String(value).toLowerCase()] || text(value);
}
