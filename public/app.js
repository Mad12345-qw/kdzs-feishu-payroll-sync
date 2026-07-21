const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const params = new URLSearchParams(location.search);
const ownerAccess = params.get("access") || "";
const storedViewerToken = sessionStorage.getItem("viewerToken") || "";
const state = { data: null, view: params.get("view") || "owner", period: "today", store: "全部店铺", platform: "全部平台", basis: "placed", viewerToken: storedViewerToken };

const currency = (value) => value == null ? "—" : `¥${Number(value || 0).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const integer = (value, suffix = "") => `${Number(value || 0).toLocaleString("zh-CN", { maximumFractionDigits: 0 })}${suffix}`;
const moneyOrPending = (value, pending) => pending ? "待生成" : currency(value);
const escapeHtml = (value) => String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
const emptyRow = (columns, label = "当前筛选条件下暂无数据") => `<tr class="empty-row"><td colspan="${columns}">${label}</td></tr>`;

function authHeaders() {
  if (ownerAccess) return { "x-dashboard-access": ownerAccess };
  return state.viewerToken ? { Authorization: `Bearer ${state.viewerToken}` } : {};
}
function queryParams() {
  const query = new URLSearchParams({ period: state.period, store: state.store, platform: state.platform, basis: state.basis });
  if (state.period === "custom") { query.set("startDate", $("#custom-start").value); query.set("endDate", $("#custom-end").value); }
  if (ownerAccess) query.set("access", ownerAccess);
  return query;
}
function showLogin() { $("#login-gate").classList.remove("hidden"); $(".app-shell").classList.add("hidden"); if (window.lucide) window.lucide.createIcons(); }
function hideLogin() { $("#login-gate").classList.add("hidden"); $(".app-shell").classList.remove("hidden"); }

async function loadDashboard() {
  if (!ownerAccess && !state.viewerToken) return showLogin();
  $("#loading").classList.remove("hidden"); $("#error").classList.add("hidden"); $("#dashboard").classList.add("hidden");
  try {
    const response = await fetch(`/api/dashboard?${queryParams()}`, { headers: authHeaders() });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.message || payload.error || "读取失败");
    state.data = payload; hideLogin(); render(payload);
    $("#loading").classList.add("hidden"); $("#dashboard").classList.remove("hidden");
  } catch (error) {
    $("#loading").classList.add("hidden");
    if (error.message.includes("unauthorized")) return showLogin();
    $("#error").classList.remove("hidden"); $("#error-message").textContent = error.message;
  }
}

function renderQuickFilters(data) {
  $("#store-filter-btn").innerHTML = `${escapeHtml(state.store)} <i data-lucide="chevron-down"></i>`;
  $("#platform-filter-btn").innerHTML = `${escapeHtml(state.platform)} <i data-lucide="chevron-down"></i>`;
  $("#basis-filter-btn").innerHTML = `${state.basis === "placed" ? "下单口径" : state.basis === "shipped" ? "昨日发货" : "月度扣售后"} <i data-lucide="chevron-down"></i>`;
  $$(".period-chip").forEach((button) => button.classList.toggle("active", button.dataset.period === state.period));
  if (window.lucide) window.lucide.createIcons();
}
function openFilter(kind) {
  const popover = $("#filter-popover"); const values = kind === "store" ? ["全部店铺", ...(state.data?.filters?.stores || [])] : kind === "platform" ? ["全部平台", ...(state.data?.filters?.platforms || [])] : [["placed", "下单口径"], ["shipped", "昨日发货"], ["monthly", "月度扣售后"]];
  popover.innerHTML = values.map((value) => { const key = Array.isArray(value) ? value[0] : value; const label = Array.isArray(value) ? value[1] : value; return `<button data-filter-kind="${kind}" data-filter-value="${escapeHtml(key)}">${escapeHtml(label)}</button>`; }).join("");
  popover.classList.remove("hidden");
  $$("[data-filter-kind]").forEach((button) => button.addEventListener("click", () => { const value = button.dataset.filterValue; if (kind === "store") state.store = value; if (kind === "platform") state.platform = value; if (kind === "basis") state.basis = value; popover.classList.add("hidden"); renderQuickFilters(state.data); loadDashboard(); }));
}

function renderRules(data) {
  const panel = $("#owner-rules-panel");
  if (!data.meta.isOwner || !data.rules) return panel.classList.add("hidden");
  panel.classList.remove("hidden");
  $("#rule-team-rate").value = Number(data.rules["团队计提比例"] || 0) * 100;
  $("#rule-cap").value = data.rules["单件团队封顶"] || 0;
  $("#rule-streamer-split").value = Number(data.rules["主播分配比例"] || 0) * 100;
  $("#rule-control-split").value = Number(data.rules["中控分配比例"] || 0) * 100;
  $("#rule-assistant-split").value = Number(data.rules["助播分配比例"] || 0) * 100;
  $("#rule-effective-date").value = data.period.endDate;
}

function render(data) {
  const { meta, summary, commissions = [], team = [], deductions = [], operationalExceptions = [], products = [], reminders = [], viewer } = data;
  $("#welcome-line").textContent = `${escapeHtml(viewer?.name || "老板")}，欢迎你`;
  $("#data-note").textContent = meta.source;
  $("#data-date").textContent = `${data.period.label} ${data.period.startDate} 至 ${data.period.endDate}`;
  renderQuickFilters(data); renderRules(data);
  const isOwner = Boolean(meta.isOwner);
  const employeeView = viewer?.role === "中控" ? "control" : "streamer";
  $$("[data-view]").forEach((element) => {
    const view = element.dataset.view;
    element.classList.toggle("hidden", !isOwner && view !== employeeView && view !== "collab");
  });
  $(".mobile-nav").style.gridTemplateColumns = isOwner ? "repeat(4, 1fr)" : "repeat(2, 1fr)";
  $("#collab-data-panel").classList.toggle("hidden", !isOwner);
  $("#feishu-link").classList.toggle("hidden", !isOwner || !data.links?.feishu);
  $("#collab-feishu").classList.toggle("hidden", !isOwner || !data.links?.feishu);
  if (!isOwner) {
    state.store = viewer.store;
    $("#store-filter-btn").classList.add("hidden");
  } else {
    $("#store-filter-btn").classList.remove("hidden");
  }
  $("#owner-sales").textContent = currency(summary.sales); $("#owner-profit").textContent = moneyOrPending(summary.profit, summary.profitPending);
  $("#owner-refund").textContent = currency(summary.refundAmount); $("#owner-loss").textContent = currency(summary.misShipmentLoss); $("#month-profit").textContent = moneyOrPending(summary.monthProfit, summary.monthProfit == null);
  $("#month-team-commission").textContent = moneyOrPending(summary.monthTeamCommission, summary.monthTeamCommission == null); $("#month-after-sales").textContent = moneyOrPending(summary.monthAfterSalesLoss, summary.monthAfterSalesLoss == null);
  $("#owner-commission-body").innerHTML = commissions.length ? commissions.map((item) => `<tr><td><strong>${escapeHtml(item.name)}</strong></td><td>${escapeHtml(item.role)}</td><td>${escapeHtml(item.store)}</td><td>${isOwner ? moneyOrPending(item.grossCommission, item.pending) : ""}</td><td class="money">${moneyOrPending(item.commission, item.pending)}</td></tr>`).join("") : emptyRow(5, "暂无人员配置");
  $("#owner-product-body").innerHTML = products.length ? products.map((item) => `<tr><td><strong>${escapeHtml(item.name)}</strong></td><td>${escapeHtml(item.store)}</td><td>${integer(item.quantity, " 件")}</td><td>${currency(item.sales)}</td><td>${currency(item.cost)}</td><td class="money">${currency(item.profit)}</td><td class="money">${currency(item.teamCommission)}</td><td>${currency(item.roleCommission?.主播)}</td><td>${currency(item.roleCommission?.中控)}</td><td>${currency(item.roleCommission?.助播)}</td></tr>`).join("") : emptyRow(10, summary.profitPending ? "ERP 毛利报表生成后自动展示商品提成" : "暂无商品利润明细");
  $("#owner-exception-body").innerHTML = isOwner && operationalExceptions.length ? operationalExceptions.map((item) => `<tr><td>${escapeHtml(item.type)}</td><td>${escapeHtml(item.orderNo)}</td><td>${escapeHtml(item.store || "—")}</td><td>${escapeHtml(item.name || "—")}</td><td>${escapeHtml(item.reason || "—")}</td><td>${escapeHtml(item.status || "—")}</td><td class="money">${currency(item.amount)}</td></tr>`).join("") : emptyRow(7, "当前筛选期间暂无售后或错发明细");
  $("#reminder-list").innerHTML = reminders.map((item) => `<div class="reminder">${escapeHtml(item)}</div>`).join("");

  const mine = commissions[0];
  $("#stream-orders").textContent = integer(summary.orderCount, " 单"); $("#stream-sales").textContent = currency(summary.sales); $("#stream-commission").textContent = moneyOrPending(mine?.commission, mine?.pending || summary.profitPending); $("#stream-rate").textContent = "今日个人预估"; $("#stream-yesterday-commission").textContent = moneyOrPending(summary.yesterdayShippedCommission, summary.yesterdayShippedPending); $("#stream-shipped").textContent = `昨日 ERP 实发 ${integer(summary.shippedCount, " 件")}`;
  $("#stream-product-body").innerHTML = products.length ? products.map((item) => `<tr><td><strong>${escapeHtml(item.name)}</strong></td><td>${integer(item.quantity, " 件")}</td><td>${currency(item.sales)}</td><td class="money">${moneyOrPending(item.personalCommission, summary.profitPending)}</td></tr>`).join("") : emptyRow(4, summary.profitPending ? "等待 ERP 单品利润生成" : "暂无今日商品数据");
  $("#stream-income").innerHTML = mine ? `<span>${escapeHtml(mine.name)} · ${escapeHtml(mine.store)}</span><strong>${moneyOrPending(mine.commission, mine.pending)}</strong><small>只显示本人到手提成与本人责任扣款</small>` : `<span>本人预估提成</span><strong>待配置</strong><small>请在人员表配置登录账号与 PIN</small>`;
  renderDetails($("#stream-deductions"), deductions, "当前没有本人扣款");
  $("#control-orders").textContent = integer(summary.orderCount, " 单"); $("#control-shipped").textContent = integer(summary.shippedCount, " 件"); $("#control-refunds").textContent = integer(summary.refundCount, " 单"); $("#control-commission").textContent = moneyOrPending(mine?.commission, mine?.pending || summary.profitPending); renderDetails($("#control-deductions"), deductions, "当前没有本人扣款");
  $("#control-exception-body").innerHTML = operationalExceptions.length ? operationalExceptions.map((item) => `<tr><td>${escapeHtml(item.type)}</td><td>${escapeHtml(item.orderNo)}</td><td>${escapeHtml(item.store || "—")}</td><td>${escapeHtml(item.reason || "—")}</td><td>${escapeHtml(item.status || "—")}</td></tr>`).join("") : emptyRow(5, "当前筛选期间暂无店铺异常");
  $("#team-cards").innerHTML = mine ? `<div class="team-card"><span>${escapeHtml(mine.name)} · ${escapeHtml(mine.role)}</span><strong>${moneyOrPending(mine.commission, mine.pending)}</strong></div>` : `<div class="team-card"><span>本人账号未配置</span><strong>—</strong></div>`;
  $("#collab-product-body").innerHTML = products.length ? products.map((item, index) => `<tr><td>${index + 1}</td><td><strong>${escapeHtml(item.name)}</strong></td><td>${integer(item.quantity, " 件")}</td><td>${currency(item.sales)}</td><td>${meta.isOwner ? currency(item.profit) : "—"}</td><td>${meta.isOwner ? currency(item.teamCommission) : moneyOrPending(item.personalCommission, summary.profitPending)}</td><td><span class="pill">已同步</span></td></tr>`).join("") : emptyRow(7);
  const feishuUrl = data.links?.feishu || ""; const planUrl = data.links?.plan || ""; const doubaoUrl = data.links?.doubao || "https://www.doubao.com/";
  if (feishuUrl) ["#feishu-link", "#collab-feishu"].forEach((id) => $(id).href = feishuUrl); ["#doubao-link", "#owner-doubao", "#collab-doubao", "#collab-ai"].forEach((id) => $(id).href = doubaoUrl);
  $("#collab-plan").classList.toggle("hidden", !isOwner || !planUrl); if (planUrl) $("#collab-plan").href = planUrl;
  if (!isOwner) { switchView(employeeView); $("#owner-rules-panel").classList.add("hidden"); }
  if (window.lucide) window.lucide.createIcons();
}

function renderDetails(container, rows, emptyText) { container.innerHTML = rows.length ? rows.map((item) => `<div class="detail-item"><strong>${escapeHtml(item.type)}${item.name ? ` · ${escapeHtml(item.name)}` : ""}</strong><b>-${currency(item.amount)}</b><small>${escapeHtml(item.note || item.date || "已登记")}</small><small>${escapeHtml(item.status)}</small></div>`).join("") : `<div class="detail-item"><strong>${escapeHtml(emptyText)}</strong><small>责任扣款需在飞书“18_提成扣款明细”登记</small></div>`; }
const viewTitles = { owner: ["经营数据一眼看完", "老板经营总览"], streamer: ["只看本人订单与提成", "主播工作台"], control: ["只看本人订单、售后与提成", "中控工作台"], collab: ["一份数据，三人协作", "直播协同工作台"] };
function switchView(view) {
  const viewer = state.data?.viewer;
  if (state.data && !state.data.meta?.isOwner) {
    const employeeView = viewer?.role === "中控" ? "control" : "streamer";
    if (view !== employeeView && view !== "collab") view = employeeView;
  }
  state.view = view; $$(".view").forEach((element) => element.classList.toggle("active", element.id === `view-${view}`)); $$('[data-view]').forEach((element) => element.classList.toggle("active", element.dataset.view === view)); $("#page-eyebrow").textContent = viewTitles[view][0]; $("#page-title").textContent = viewTitles[view][1];
}

async function login() { const response = await fetch("/api/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ account: $("#login-account").value.trim(), pin: $("#login-pin").value.trim() }) }); const result = await response.json(); if (!response.ok) { $("#login-error").textContent = result.message || "登录失败"; return; } state.viewerToken = result.token; sessionStorage.setItem("viewerToken", result.token); await loadDashboard(); }

$$('[data-view]').forEach((button) => button.addEventListener("click", () => switchView(button.dataset.view)));
$("#refresh-btn").addEventListener("click", loadDashboard); $("#retry-btn").addEventListener("click", loadDashboard); $("#login-submit").addEventListener("click", login);
$("#custom-date-btn").addEventListener("click", () => $("#custom-date-popover").classList.toggle("hidden")); $("#custom-apply").addEventListener("click", () => { state.period = "custom"; $("#custom-date-popover").classList.add("hidden"); loadDashboard(); });
$("#store-filter-btn").addEventListener("click", () => openFilter("store")); $("#platform-filter-btn").addEventListener("click", () => openFilter("platform")); $("#basis-filter-btn").addEventListener("click", () => openFilter("basis")); $$(".period-chip").forEach((button) => button.addEventListener("click", () => { state.period = button.dataset.period; loadDashboard(); }));
$("#save-rules-btn").addEventListener("click", async () => { const rules = { "团队计提比例": Number($("#rule-team-rate").value) / 100, "单件团队封顶": Number($("#rule-cap").value), "主播分配比例": Number($("#rule-streamer-split").value) / 100, "中控分配比例": Number($("#rule-control-split").value) / 100, "助播分配比例": Number($("#rule-assistant-split").value) / 100 }; const response = await fetch("/api/rules", { method: "POST", headers: { ...authHeaders(), "content-type": "application/json" }, body: JSON.stringify({ rules, effectiveDate: $("#rule-effective-date").value }) }); if (!response.ok) return alert("规则保存失败，请检查权限和比例合计。"); await loadDashboard(); });
$$(".copy-prompt").forEach((button) => button.addEventListener("click", async () => { try { await navigator.clipboard.writeText(button.dataset.prompt || ""); button.textContent = "已复制，去豆包粘贴"; setTimeout(() => { button.textContent = "复制提示词"; }, 1800); } catch { alert("复制失败，请手动复制提示词。"); } }));
if (window.lucide) window.lucide.createIcons(); loadDashboard();
