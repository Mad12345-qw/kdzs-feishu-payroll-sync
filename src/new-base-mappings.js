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

const PROFIT_NUMBER_FIELDS = [
  "number", "payment", "paymentCost", "paymentProfit", "paymentProfitMargin", "income", "postCost",
  "netSalesProfit", "netSalesProfitMargin", "actualNumber", "actualCost", "actualPayment", "refundNum",
  "refundAmount", "refundCost", "netSales", "netSalesNum", "netSalesCost", "tidCount", "ptTidCount",
  "hasRefundNum", "refundProfit", "beforeRefundAmount", "afterRefundAmount", "platformDiscount", "costPrice",
  "postFee", "paymentAverage", "itemNum", "sysCostPrice",
];

function rawProfitFields(item) {
  const row = {};
  for (const field of PROFIT_NUMBER_FIELDS) row[field] = number(item[field]);
  for (const field of [
    "source", "tid", "orderId", "orderStatus", "outerSkuId", "outerId", "isCombination", "sysSkuAlias",
    "skuPicPath", "url", "skuId", "skuName", "itemId", "itemTitle", "sysSkuPicPath", "classifyName",
    "brand", "sysOuterSkuId", "sysSkuName", "sysOuterId", "sysItemAlias", "refundId", "sellerNick", "platform",
    "saleName", "saleMobile", "saleStatusDesc",
  ]) row[field] = text(item[field]);
  for (const field of ["saleStatus", "saleUserId", "userId", "orderStatus", "isCombination", "sysSkuId", "sysItemId"]) {
    row[field] = number(item[field]);
  }
  return row;
}

export function mapOrderProfit(items, day) {
  return uniqueBy(items.map((item) => {
    const key = `${day}|${text(item.platform)}|${text(item.sellerNick)}|${text(item.tid)}`;
    return { "同步唯一键": key, "文本": key, date: day, ...rawProfitFields(item) };
  }), (row) => row["同步唯一键"]);
}

export function mapProductProfit(items, day) {
  return uniqueBy(items.map((item) => {
    const key = `${day}|${text(item.platform)}|${text(item.sellerNick)}|${text(item.tid)}|${text(item.orderId)}|${text(item.itemId)}|${text(item.skuId)}`;
    return {
      "同步唯一键": key, "文本": key, date: day, "日期": Date.parse(`${day}T00:00:00+08:00`),
      source: text(item.source), saleUserId: number(item.saleUserId), saleName: text(item.saleName),
      saleMobile: text(item.saleMobile), saleStatus: number(item.saleStatus), saleStatusDesc: text(item.saleStatusDesc),
      userId: number(item.userId), "平台类型": text(item.platform), "店铺名称": text(item.sellerNick),
      "销售数量": number(item.number), "销售金额": number(item.payment), "销售成本": number(item.paymentCost),
      "销售毛利": number(item.paymentProfit), "销售毛利率": number(item.paymentProfitMargin),
      "实际收入": number(item.income), "运费成本": number(item.postCost), "邮费": number(item.postFee),
      "利润": number(item.netSalesProfit), "利润率": number(item.netSalesProfitMargin),
      "实发数量": number(item.actualNumber), "实发商品成本": number(item.actualCost),
      "实发金额": number(item.actualPayment), "退款数量": number(item.refundNum),
      "退款金额": number(item.refundAmount), "退货成本": number(item.refundCost),
      "净销售额": number(item.netSales), "净销量": number(item.netSalesNum),
      "实际货品成本": number(item.netSalesCost), "订单数": number(item.tidCount),
      "对应平台订单数量": number(item.ptTidCount), "实退数量": number(item.hasRefundNum),
      "退货毛利": number(item.refundProfit), "发货前退货金额": number(item.beforeRefundAmount),
      "发货后退款金额": number(item.afterRefundAmount), "平台折扣金额": number(item.platformDiscount),
      "成本费用 = 商品成本 + 运费成本": number(item.costPrice),
      "商品数量 =实发数量-退货数量": number(item.itemNum), "销售均价": number(item.paymentAverage),
      "订单id": text(item.tid), "子订单id": text(item.orderId), orderStatus: number(item.orderStatus),
      "规格编码": text(item.outerSkuId), "商家编码": text(item.outerId), isCombination: number(item.isCombination),
      sysSkuAlias: text(item.sysSkuAlias), skuPicPath: text(item.skuPicPath), "图片url": text(item.url),
      sku: text(item.skuId), "sku名称": text(item.skuName), "商品id": text(item.itemId),
      "商品标题": text(item.itemTitle), sysSkuPicPath: text(item.sysSkuPicPath), classifyName: text(item.classifyName),
      brand: text(item.brand), sysCostPrice: number(item.sysCostPrice), "货品规格商家编码": text(item.sysOuterSkuId),
      sysSkuName: text(item.sysSkuName), sysSkuId: number(item.sysSkuId), sysOuterId: text(item.sysOuterId),
      "货品简称": text(item.sysItemAlias), sysItemId: number(item.sysItemId), refundId: text(item.refundId),
    };
  }), (row) => row["同步唯一键"]);
}

export function mapLogistics(items) {
  return uniqueBy(items.map((item) => ({
    "同步唯一键": `${text(item.tid)}|${text(item.ydNo)}`, "订单号": text(item.tid), "运单号": text(item.ydNo),
    "店铺名称": text(item.shopName), "平台": text(item.shopType || item.ptType), "快递公司编码": text(item.kdCode),
    "快递模板名称": text(item.exCodeName), "发货时间": text(item.sendTime), "最新物流时间": text(item.lastTime),
    "最新物流详情": text(item.lastDesc), "物流状态": text(item.logisticsYunStatusVal),
    "物流子状态": text(item.subLogisticsStatus), "异常状态": number(item.abnormalStatus),
    "处理状态": number(item.dealStatus), "退款状态类型": text(item.refundStatusType),
    "收货省": text(item.receiverProvince), "收货市": text(item.receiverCity), "收货区县": text(item.receiverCounty),
  })), (row) => row["同步唯一键"]);
}

export function mapStockIn(items) {
  const rows = [];
  for (const entry of items) for (const item of entry.items || []) rows.push({
    "同步唯一键": `${text(entry.reachNo)}|${text(item.skuOuterId)}|${text(item.sysItemAlias)}`,
    "入库单号": text(entry.reachNo), "供应商": text(entry.supplierName), "创建时间": text(entry.createTime),
    "入库状态": number(entry.reachStatus), "入库人": text(entry.createUser), "入库备注": text(entry.memo),
    "总入库数量": number(entry.reachCount), "总成本金额": number(entry.totalCostAmount),
    "运费": number(entry.carriage), "其他费用": number(entry.otherCost), "货品简称": text(item.sysItemAlias),
    "SKU编码": text(item.skuOuterId), "入库数量": number(item.instockCount), "单价": number(item.price),
    "成本价": number(item.costPrice), "明细备注": text(item.remark), "图片": text(item.picUrl),
  });
  return uniqueBy(rows, (row) => row["同步唯一键"]);
}

export function mapPurchases(items) {
  const rows = [];
  for (const purchase of items) for (const item of purchase.items || []) rows.push({
    "同步唯一键": `${text(purchase.purchaseNo)}|${text(item.sysSkuId || item.skuOuterId)}|${text(item.sysItemId)}`,
    "采购单号": text(purchase.purchaseNo), "采购单名称": text(purchase.purchaseName), "供应商": text(purchase.supplierName),
    "采购状态": number(purchase.purchaseStatus), "采购总数量": number(purchase.purchaseCount),
    "采购总金额": number(purchase.purchaseTotalAmount), "采购运费": number(purchase.carriage),
    "其他费用": number(purchase.otherCost), "创建时间": text(purchase.createTime), "创建人": text(purchase.createUser),
    "采购备注": text(purchase.memo), "系统商品ID": text(item.sysItemId), "系统SKUID": text(item.sysSkuId),
    "货品名称": text(item.sysItemName), "货品简称": text(item.sysItemAlias), "SKU名称": text(item.sysSkuName),
    "SKU别名": text(item.sysSkuAlias), "SKU编码": text(item.skuOuterId), "商品编码": text(item.outerId),
    "采购数量": number(item.purchaseNum), "已入库数量": number(item.instockNum), "成本价": number(item.costPrice),
    "金额小计": number(item.amount), "明细备注": text(item.memo), "图片": text(item.picUrl),
  });
  return uniqueBy(rows, (row) => row["同步唯一键"]);
}
