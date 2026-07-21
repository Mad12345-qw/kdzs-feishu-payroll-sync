const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const initialParams = new URLSearchParams(location.search);
const initialView = ["owner", "streamer", "control", "collab"].includes(initialParams.get("view")) ? initialParams.get("view") : "owner";
const state = { data: null, view: initialView, access: initialParams.get("access") || sessionStorage.getItem("dashboardAccess") || "" };
if (state.access) sessionStorage.setItem("dashboardAccess", state.access);

const currency = (value) => `¥${Number(value || 0).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const integer = (value, suffix = "") => `${Number(value || 0).toLocaleString("zh-CN", { maximumFractionDigits: 0 })}${suffix}`;
const percent = (value) => `${(Number(value || 0) * 100).toFixed(2).replace(/\.00$/, "")}%`;
const emptyRow = (columns, label = "当前筛选条件下暂无数据") => `<tr class="empty-row"><td colspan="${columns}">${label}</td></tr>`;
const escapeHtml = (value) => String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));

function setOptions(element, values, current, allLabel) {
  const options = allLabel ? [allLabel, ...values] : values;
  element.innerHTML = options.map((value) => `<option value="${escapeHtml(value)}" ${value === current ? "selected" : ""}>${escapeHtml(value)}</option>`).join("");
}

function currentFilters() {
  return {
    date: $("#date-filter").value,
    store: $("#store-filter").value || "全部店铺",
    platform: $("#platform-filter").value || "全部平台",
    basis: $("#basis-filter").value || "placed",
    role: $("#role-filter").value || "全部角色",
  };
}

async function loadDashboard(preserveFilters = true) {
  $("#loading").classList.remove("hidden"); $("#error").classList.add("hidden"); $("#dashboard").classList.add("hidden");
  const old = preserveFilters && state.data ? currentFilters() : {};
  const params = new URLSearchParams(Object.fromEntries(Object.entries(old).filter(([, value]) => value)));
  if (state.access) params.set("access", state.access);
  try {
    const response = await fetch(`/api/dashboard?${params}`, { headers: state.access ? { "x-dashboard-access": state.access } : {} });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error === "unauthorized" ? "访问链接缺少授权码，请使用飞书中的正式入口。" : (payload.message || payload.error || "读取失败"));
    state.data = payload;
    render(payload, old);
    $("#loading").classList.add("hidden"); $("#dashboard").classList.remove("hidden");
  } catch (error) {
    $("#loading").classList.add("hidden"); $("#error").classList.remove("hidden"); $("#error-message").textContent = error.message;
  }
}

function render(data, previous = {}) {
  const { meta, filters, summary, commissions, team, deductions, products, reminders } = data;
  setOptions($("#date-filter"), filters.dates, meta.selectedDate);
  setOptions($("#store-filter"), filters.stores, previous.store || "全部店铺", "全部店铺");
  setOptions($("#platform-filter"), filters.platforms, previous.platform || "全部平台", "全部平台");
  setOptions($("#role-filter"), filters.roles, previous.role || "全部角色", "全部角色");
  $("#basis-filter").value = meta.basis;
  $("#data-note").textContent = meta.note;
  $("#data-date").textContent = `数据日期 ${meta.selectedDate}`;
  $("#sync-label").textContent = `最新数据 ${meta.latestDataDate || "待同步"}`;
  $("#basis-label").textContent = meta.basisLabel;
  $("#owner-sales").textContent = currency(summary.sales);
  $("#owner-profit").textContent = currency(summary.profit);
  $("#owner-refund").textContent = currency(summary.refundAmount);
  $("#owner-loss").textContent = currency(summary.misShipmentLoss);
  $("#month-profit").textContent = currency(summary.monthProfit);
  $("#owner-commission-body").innerHTML = commissions.length ? commissions.map((item) => `<tr><td><strong>${escapeHtml(item.name)}</strong></td><td>${escapeHtml(item.role)}</td><td>${escapeHtml(item.store)}</td><td>${percent(item.rate)}</td><td class="money">${currency(item.commission)}</td></tr>`).join("") : emptyRow(5, "人员表中暂无符合条件的员工");
  $("#reminder-list").innerHTML = reminders.map((item) => `<div class="reminder">${escapeHtml(item)}</div>`).join("");

  const mine = commissions[0];
  $("#stream-orders").textContent = integer(summary.orderCount, " 单");
  $("#stream-sales").textContent = currency(summary.sales);
  $("#stream-commission").textContent = currency(mine?.commission || summary.teamCommission);
  $("#stream-rate").textContent = mine ? `${mine.name} · ${percent(mine.rate)}` : "请选择店铺或配置人员";
  $("#stream-shipped").textContent = integer(summary.shippedCount, " 件");
  const productRows = products.length ? products.map((item) => `<tr><td><strong>${escapeHtml(item.name)}</strong></td><td>${integer(item.quantity, " 件")}</td><td>${currency(item.sales)}</td><td class="money">${currency(item.profit)}</td></tr>`).join("") : emptyRow(4);
  $("#stream-product-body").innerHTML = productRows;
  $("#stream-income").innerHTML = mine ? `<span>${escapeHtml(mine.name)} · ${escapeHtml(mine.store)}</span><strong>${currency(mine.commission)}</strong><small>ERP 利润 ${currency(mine.profit)} × ${percent(mine.rate)} − 扣款 ${currency(mine.deduction)}</small>` : `<span>团队预计提成</span><strong>${currency(summary.teamCommission)}</strong><small>选择具体店铺后可查看个人数据</small>`;
  renderDetails($("#stream-deductions"), deductions, "当前没有扣款记录");

  $("#control-orders").textContent = integer(summary.orderCount, " 单");
  $("#control-shipped").textContent = integer(summary.shippedCount, " 件");
  $("#control-refunds").textContent = integer(summary.refundCount, " 单");
  $("#control-commission").textContent = currency(summary.teamCommission);
  $("#team-cards").innerHTML = team.length ? team.map((item) => `<div class="team-card"><span>${escapeHtml(item.role)} · ${item.members} 人</span><strong>${currency(item.commission)}</strong></div>`).join("") : `<div class="team-card"><span>暂无角色配置</span><strong>—</strong></div>`;
  renderDetails($("#control-deductions"), deductions, "当前没有待处理扣款或异常");

  $("#collab-product-body").innerHTML = products.length ? products.map((item, index) => `<tr><td>${index + 1}</td><td><strong>${escapeHtml(item.name)}</strong></td><td>${integer(item.quantity, " 件")}</td><td>${currency(item.sales)}</td><td>${item.stock == null ? "ERP未关联" : integer(item.stock, " 件")}</td><td class="money">${currency(item.profit)}</td><td><span class="pill">已同步</span></td></tr>`).join("") : emptyRow(7);

  const feishuUrl = data.links?.feishu || "https://dcnx0esypql0.feishu.cn/base/SgoybTSbCa1G25s81rbcsBcxnJd";
  const doubaoUrl = data.links?.doubao || "https://www.doubao.com/";
  ["#feishu-link", "#collab-feishu"].forEach((id) => $(id).href = feishuUrl);
  ["#doubao-link", "#owner-doubao", "#collab-doubao", "#collab-ai"].forEach((id) => $(id).href = doubaoUrl);
  if (window.lucide) window.lucide.createIcons();
}

function renderDetails(container, rows, emptyText) {
  container.innerHTML = rows.length ? rows.map((item) => `<div class="detail-item"><strong>${escapeHtml(item.type)} · ${escapeHtml(item.name || item.store)}</strong><b>-${currency(item.amount)}</b><small>${escapeHtml(item.note || item.date || "已登记")}</small><small>${escapeHtml(item.status)}</small></div>`).join("") : `<div class="detail-item"><strong>${escapeHtml(emptyText)}</strong><small>扣款数据需在飞书“18_提成扣款明细”登记</small></div>`;
}

const viewTitles = {
  owner: ["经营数据一眼看完", "老板经营总览"], streamer: ["成交、发货、提成直观展示", "主播工作台"],
  control: ["订单、售后与团队提成", "中控工作台"], collab: ["一份数据，三人协作", "直播协同工作台"],
};
function switchView(view) {
  state.view = view;
  $$(".view").forEach((element) => element.classList.toggle("active", element.id === `view-${view}`));
  $$('[data-view]').forEach((element) => element.classList.toggle("active", element.dataset.view === view));
  $("#page-eyebrow").textContent = viewTitles[view][0]; $("#page-title").textContent = viewTitles[view][1];
  scrollTo({ top: 0, behavior: "smooth" });
}

$$('[data-view]').forEach((button) => button.addEventListener("click", () => switchView(button.dataset.view)));
[$("#date-filter"), $("#store-filter"), $("#platform-filter"), $("#basis-filter"), $("#role-filter")].forEach((element) => element.addEventListener("change", () => loadDashboard(true)));
$("#refresh-btn").addEventListener("click", () => loadDashboard(true));
$("#retry-btn").addEventListener("click", () => loadDashboard(true));
switchView(state.view);
if (window.lucide) window.lucide.createIcons();
loadDashboard(false);
