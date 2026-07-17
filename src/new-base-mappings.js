import { number, text, uniqueBy } from "./utils.js";

export function mapNewOrders(trades) {
  return uniqueBy(trades.map((trade) => ({
    "同步唯一键": text(trade.tid), "文本": text(trade.tid), tid: text(trade.tid), ptTid: text(trade.ptTid),
    sellerId: text(trade.sellerId), sellerNick: text(trade.sellerNick), platform: text(trade.platform),
    platformDesc: text(trade.platformDesc), source: text(trade.source), buyerMessage: text(trade.buyerMessage),
    sellerFlag: text(trade.sellerFlag), sellerMemo: text(trade.sellerMemo), status: text(trade.status),
    refundStatus: text(trade.refundStatus), receiverState: text(trade.receiverState), receiverCity: text(trade.receiverCity),
    receiverDistrict: text(trade.receiverDistrict), sysShipTime: text(trade.sysShipTime), payment: text(trade.payment),
    receivedPayment: text(trade.receivedPayment), lastShipTime: text(trade.lastShipTime), created: text(trade.created), modified: text(trade.modified),
  })), (row) => row["同步唯一键"]);
}

export function mapNewOrderItems(trades) {
  const rows = [];
  for (const trade of trades) for (const item of trade.orderList || []) rows.push({
    "同步唯一键": `${text(trade.tid)}|${text(item.oid || item.ptOid)}`, "文本": `${text(trade.tid)}|${text(item.oid || item.ptOid)}`,
    tid: text(trade.tid), ptTid: text(trade.ptTid), oid: text(item.oid), ptOid: text(item.ptOid), title: text(item.title),
    outerId: text(item.outerId), numiid: text(item.numiid), skuId: text(item.skuId), skuOuterId: text(item.skuOuterId),
    skuUrl: text(item.skuUrl), sysSkuUrl: text(item.sysSkuUrl), sysOuterId: text(item.sysOuterId),
    sysOuterSkuId: text(item.sysOuterSkuId), sysSkuName: text(item.sysSkuName), sysItemName: text(item.sysItemName),
    sysItemId: text(item.sysItemId), sysSkuId: text(item.sysSkuId), skuProperties: text(item.skuProperties),
    number: text(item.number), status: text(item.status), refundStatus: text(item.refundStatus),
  });
  return uniqueBy(rows, (row) => row["同步唯一键"]);
}

export function mapNewRefunds(refunds) {
  return uniqueBy(refunds.map((refund) => ({
    "同步唯一键": text(refund.refundId), "退款编号": text(refund.refundId), "系统订单号": text(refund.tid),
    "平台订单号": text(refund.ptTid), "店铺名称": text(refund.sellerNick), "店铺ID": text(refund.sellerId),
    "平台": text(refund.platform), "售后类型": text(refund.afterSaleType), "退款状态": text(refund.refundStatus),
    "退款状态说明": text(refund.refundStatusDesc), "货物状态": text(refund.goodsStatus), "货物状态说明": text(refund.goodsStatusDesc),
    "退款原因": text(refund.refundReason), "退款金额": number(refund.refundAmount), "创建时间": text(refund.refundCreatedTime),
    "修改时间": text(refund.refundModifiedTime), "物流公司": text(refund.logisticsName), "退货单号": text(refund.returnLogisticsNo),
  })), (row) => row["同步唯一键"]);
}

export function mapNewRefundItems(refunds) {
  const rows = [];
  for (const refund of refunds) for (const item of refund.items || []) rows.push({
    "同步唯一键": `${text(refund.refundId)}|${text(item.outerSkuId)}|${text(item.title)}|${text(item.skuProperties)}`,
    "退款编号": text(refund.refundId), "商品标题": text(item.title), "规格名称": text(item.skuProperties),
    "商家编码": text(item.outerId), "规格编码": text(item.outerSkuId), "退款数量": number(item.refundNum),
    "退款金额": number(item.refundAmount),
  });
  return uniqueBy(rows, (row) => row["同步唯一键"]);
}

export function mapNewPlatformProducts(items) {
  return uniqueBy(items.map((item) => ({
    "同步唯一键": text(item.numIid), "商品id": text(item.numIid), "商品标题": text(item.title),
    "商品简称": text(item.itemAlias), "商品图片链接": text(item.itemPicUrl), "商品状态": text(item.approveStatus),
    "商家编码": text(item.outerId), "系统变化平台商家编码": text(item.varietyOuterId),
  })), (row) => row["同步唯一键"]);
}

export function mapNewPlatformSkus(items) {
  const rows = [];
  for (const item of items) for (const sku of item.platformItemSkuList || []) rows.push({
    "同步唯一键": `${text(item.numIid)}|${text(sku.skuId)}`, "商品id": text(item.numIid),
    "商品skuId": text(sku.skuId), "规格名称": text(sku.skuName), "商家编码": text(sku.skuOuterId),
    "商品规格平台售价": text(sku.price), "商品规格重量": text(sku.skuWeight), "商品规格上新时间": text(sku.itemSkuCreateTime),
  });
  return uniqueBy(rows, (row) => row["同步唯一键"]);
}

export function mapNewErpProducts(items) {
  return uniqueBy(items.map((item) => ({
    "同步唯一键": text(item.sysItemId), sysItemId: number(item.sysItemId), sysItemName: text(item.sysItemName),
    sysItemAlias: text(item.sysItemAlias), outerId: text(item.outerId), classifyId: number(item.classifyId),
    classifyName: text(item.classifyName), brandId: number(item.brandId), brandName: text(item.brandName),
    property: number(item.property), created: text(item.created), modified: text(item.modified),
  })), (row) => row["同步唯一键"]);
}

export function mapNewErpSkus(items) {
  const rows = [];
  for (const item of items) for (const sku of item.skuList || []) rows.push({
    "同步唯一键": `${text(item.sysItemId)}|${text(sku.sysSkuId)}`, "ERP商品ID": text(item.sysItemId),
    sysSkuId: number(sku.sysSkuId), barCode: text(sku.barCode), sysSkuName: text(sku.sysSkuName),
    sysSkuAlias: text(sku.sysSkuAlias), skuOuterId: text(sku.skuOuterId), price: text(sku.price),
    costPrice: text(sku.costPrice), tagPrice: text(sku.tagPrice), weight: text(sku.weight),
    warehouseSlotName: text(sku.warehouseSlotName), sysColor: text(sku.sysColor), sysSize: text(sku.sysSize),
    itemNo: text(sku.itemNo), supplierName: text(sku.supplierName), created: text(sku.created), modified: text(sku.modified),
  });
  return uniqueBy(rows, (row) => row["同步唯一键"]);
}

export function mapNewStock(items) {
  return uniqueBy(items.map((item) => ({
    "同步唯一键": text(item.sysSkuId), "货品ID": text(item.sysItemId), "货品规格ID": text(item.sysSkuId),
    "ERP货品简称": text(item.sysItemAlias), "货品规格名称": text(item.sysSkuName), "货品规格别名": text(item.sysSkuAlias),
    "条形码": text(item.barCode), "货号": text(item.itemNo), "实际总库存": number(item.stockTotal),
    "可配货库存": number(item.salableItemDistributableStock), "订单占用库存": number(item.salableItemPreemptedNum),
    "采购在途库存": number(item.transitItemStock), "消退在途库存": number(item.refundStockWaitHandNum),
  })), (row) => row["同步唯一键"]);
}

export function mapNewStoreProfit(items, day) {
  return uniqueBy(items.map((item) => ({
    "同步唯一键": `${day}|${text(item.platform)}|${text(item.sellerNick)}`, "文本": `${day}|${text(item.platform)}|${text(item.sellerNick)}`,
    platform: text(item.platform), "店铺名称": text(item.sellerNick), "销售数量": number(item.number), "销售金额": number(item.payment),
    "销售成本": number(item.paymentCost), "销售毛利": number(item.paymentProfit), "销售毛利率": number(item.paymentProfitMargin),
    "实际收入": number(item.income), "运费成本": number(item.postCost), "利润": number(item.netSalesProfit),
    "利润率": number(item.netSalesProfitMargin), "实发数量": number(item.actualNumber), "实发商品成本": number(item.costPrice),
    "实发金额": number(item.actualPayment), "退款数量": number(item.refundNum || item.hasRefundNum), "退款金额": number(item.refundAmount),
    "退货成本": number(item.refundCost), "净销售额": number(item.netSales), "净销量": number(item.netSalesNum),
    "成本费用": number(item.netSalesCost) + number(item.postCost), "数据日期": Date.parse(`${day}T00:00:00+08:00`),
  })), (row) => row["同步唯一键"]);
}

export function mapCuratedStoreProfit(items, day) {
  return uniqueBy(items.map((item) => ({
    "同步唯一键": `${day}|${text(item.platform)}|${text(item.sellerNick)}`, "统计日期": Date.parse(`${day}T00:00:00+08:00`),
    "店铺名称": text(item.sellerNick), "平台": text(item.platform), "销售金额": number(item.payment),
    "净销售额": number(item.netSales), "退款金额": number(item.refundAmount),
    "成本费用": number(item.netSalesCost) + number(item.postCost), "运费成本": number(item.postCost),
    "利润": number(item.netSalesProfit), "利润率": number(item.netSalesProfitMargin) / 100,
    "订单数": number(item.tidCount), "商品数量": number(item.netSalesNum), "备注": "ERP毛利润接口自动同步",
  })), (row) => row["同步唯一键"]);
}
