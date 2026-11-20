import { supabase, money, colorFor, localISO } from "./db.js";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
const TX_PAGE = 25;

let categories = [];
let catById = new Map();
let expenses = [];   // { id, amount, date, note, category_id } — newest first
let path = [];       // breadcrumb trail of {id, name}
let currentRange = "all";
let txLimit = TX_PAGE;
let chart;

// The date QS Wallet's data starts from — used as the default "show everything" range.
const APP_START_DATE = "2026-09-06";

const iso = localISO; // local-time date string (toISOString would shift by the UTC offset)

function computeRange(key) {
  const now = new Date();
  if (key === "all") {
    return { start: APP_START_DATE, end: iso(now) };
  }
  if (key === "week") {
    const day = now.getDay();
    const diffToMonday = (day === 0 ? -6 : 1) - day;
    const monday = new Date(now);
    monday.setDate(now.getDate() + diffToMonday);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    return { start: iso(monday), end: iso(sunday) };
  }
  if (key === "month") {
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    return { start: iso(start), end: iso(end) };
  }
}

async function loadCategories() {
  const { data, error } = await supabase.from("categories").select("*");
  if (error) { console.error(error); return; }
  categories = data || [];
  catById = new Map(categories.map((c) => [c.id, c]));
}

async function loadExpenses(start, end) {
  const rows = [];
  for (let from = 0; from < 20000; from += 1000) {
    const { data, error } = await supabase
      .from("transactions")
      .select("id, amount, date, note, category_id")
      .eq("type", "expense")
      .gte("date", start)
      .lte("date", end)
      .order("date", { ascending: false })
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(from, from + 999);
    if (error) { console.error(error); break; }
    rows.push(...data);
    if (data.length < 1000) break;
  }
  // newest first (stable, so entries on the same day keep the database's order)
  rows.sort((a, b) => b.date.localeCompare(a.date));
  expenses = rows;
}

function childrenOf(parentId) {
  return categories.filter((c) => c.parent_id === parentId);
}

function directTotal(catId) {
  return expenses.filter((e) => e.category_id === catId).reduce((s, e) => s + Number(e.amount), 0);
}

function recursiveTotal(catId) {
  let total = directTotal(catId);
  childrenOf(catId).forEach((child) => { total += recursiveTotal(child.id); });
  return total;
}

function subtreeIds(rootId) {
  const ids = new Set([rootId]);
  const stack = [rootId];
  while (stack.length) {
    for (const c of childrenOf(stack.pop())) { ids.add(c.id); stack.push(c.id); }
  }
  return ids;
}

function uncategorizedTotal() {
  const validIds = new Set(categories.map((c) => c.id));
  return expenses
    .filter((e) => !e.category_id || !validIds.has(e.category_id))
    .reduce((s, e) => s + Number(e.amount), 0);
}

function currentParentId() {
  return path.length ? path[path.length - 1].id : null;
}

function fmtDate(d) {
  return new Date(d + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

// ---------- transaction list (shown inside any category) ----------
const txSection = document.createElement("div");
txSection.id = "txSection";
txSection.style.cssText = "text-align:left; margin-top:22px;";
txSection.innerHTML = `
  <h2 class="section-title" id="txTitle">Transactions</h2>
  <ul class="grouped-list" id="txList"></ul>
  <button type="button" class="btn-secondary hidden" id="txMore" style="color:var(--blue); background:var(--bg-elevated-2);">Show more</button>`;
$("legendList").insertAdjacentElement("afterend", txSection);

function renderTransactions(parentId) {
  txSection.style.display = parentId === null ? "none" : "";
  if (parentId === null) return;

  const ids = subtreeIds(parentId);
  const rows = expenses.filter((e) => ids.has(e.category_id));
  $("txTitle").textContent = `Transactions (${rows.length})`;

  const shown = rows.slice(0, txLimit);
  $("txList").innerHTML = shown.length
    ? shown.map((e) => {
        const cat = catById.get(e.category_id);
        const catName = cat ? cat.name : "Uncategorized";
        const icon = cat ? (cat.icon || "🏷️") : "🏷️";
        return `<li>
          <span class="row-left">
            <span class="row-icon" style="background:${colorFor(catName)}33">${esc(icon)}</span>
            <span>
              <div class="row-title">${esc(e.note || catName)}</div>
              <div class="row-meta">${esc(fmtDate(e.date))}${e.note ? " · " + esc(catName) : ""}</div>
            </span>
          </span>
          <span class="row-amt expense">-${money(e.amount)}</span>
        </li>`;
      }).join("")
    : `<li class="empty-note">No expenses here in this period.</li>`;

  const remaining = rows.length - shown.length;
  $("txMore").classList.toggle("hidden", remaining <= 0);
  if (remaining > 0) $("txMore").textContent = `Show ${Math.min(TX_PAGE, remaining)} more (${remaining} left)`;
}

$("txMore").addEventListener("click", () => { txLimit += TX_PAGE; render(); });

// ---------- chart + legend ----------
function render() {
  const parentId = currentParentId();
  const parent = parentId ? catById.get(parentId) : null;
  const nodes = childrenOf(parentId);
  const isLeaf = parentId !== null && nodes.length === 0;

  const items = nodes
    .map((c) => ({ id: c.id, name: c.name, icon: c.icon || "🏷️", total: recursiveTotal(c.id), drillable: true }))
    .filter((i) => i.total > 0)
    .sort((a, b) => b.total - a.total);

  if (parentId === null) {
    const unc = uncategorizedTotal();
    if (unc > 0) items.push({ id: null, name: "Uncategorized", icon: "🏷️", total: unc, drillable: false });
  } else if (!isLeaf) {
    // spending recorded on the category itself (not in a subcategory)
    const own = directTotal(parentId);
    if (own > 0) items.push({ id: null, name: "General", icon: parent ? (parent.icon || "🏷️") : "🏷️", total: own, drillable: false });
  }

  const total = parentId === null ? items.reduce((s, i) => s + i.total, 0) : recursiveTotal(parentId);
  $("totalAmount").textContent = money(total);
  $("totalLabel").textContent = parentId ? `Total in ${path[path.length - 1].name}` : "Total spent";

  renderBreadcrumb();

  // A category with no subcategories has nothing to split — show just its transactions
  const canvas = $("pieChart");
  const chartBox = canvas.parentElement;
  chartBox.style.display = isLeaf ? "none" : "";
  $("legendList").style.display = isLeaf ? "none" : "";

  if (chart) { chart.destroy(); chart = null; }
  if (!isLeaf) {
    const colors = items.map((i) => (i.id ? colorFor(i.name) : "#A39A8C"));
    chart = new Chart(canvas.getContext("2d"), {
      type: "pie",
      data: { labels: items.map((i) => i.name), datasets: [{ data: items.map((i) => i.total), backgroundColor: colors, borderColor: "#F7F4EF", borderWidth: 2 }] },
      options: {
        plugins: { legend: { display: false } },
        onClick: (evt, elements) => {
          if (!elements.length) return;
          const item = items[elements[0].index];
          if (item.drillable) drillInto(item);
        },
      },
    });

    $("legendList").innerHTML = items.length
      ? items.map((item, i) => {
          const pct = total ? Math.round((item.total / total) * 100) : 0;
          return `<li class="${item.drillable ? "tappable" : ""}" data-idx="${i}">
            <span class="row-left">
              <span class="tile-mini" style="background:${colors[i]}33">${esc(item.icon)}</span>
              <span class="row-title">${esc(item.name)}${item.drillable ? " ›" : ""}</span>
            </span>
            <span class="row-amt" style="color:${colors[i]}">${money(item.total)} · ${pct}%</span>
          </li>`;
        }).join("")
      : `<li class="empty-note">No expenses in this period.</li>`;

    $("legendList").querySelectorAll("[data-idx]").forEach((li) => {
      li.addEventListener("click", () => {
        const item = items[Number(li.dataset.idx)];
        if (item.drillable) drillInto(item);
      });
    });
  }

  renderTransactions(parentId);
}

function drillInto(item) {
  path.push({ id: item.id, name: item.name });
  txLimit = TX_PAGE;
  render();
}

function renderBreadcrumb() {
  const el = $("breadcrumb");
  const crumbs = [`<a data-crumb="-1">All</a>`, ...path.map((p, i) => `<a data-crumb="${i}">${esc(p.name)}</a>`)];
  el.innerHTML = crumbs.join(' <span class="crumb-sep">›</span> ');
  el.querySelectorAll("[data-crumb]").forEach((a) => {
    a.addEventListener("click", () => {
      const idx = Number(a.dataset.crumb);
      path = idx === -1 ? [] : path.slice(0, idx + 1);
      txLimit = TX_PAGE;
      render();
    });
  });
}

async function refresh() {
  let start, end;
  if (currentRange === "custom") {
    start = $("rangeStart").value;
    end = $("rangeEnd").value;
    if (!start || !end) return;
  } else {
    ({ start, end } = computeRange(currentRange));
  }
  await loadExpenses(start, end);
  path = [];
  txLimit = TX_PAGE;
  render();
}

$("rangePills").addEventListener("click", (e) => {
  const btn = e.target.closest(".pill");
  if (!btn) return;
  document.querySelectorAll("#rangePills .pill").forEach((p) => p.classList.remove("selected"));
  btn.classList.add("selected");
  currentRange = btn.dataset.range;
  const customWrap = $("customRangeWrap");
  if (currentRange === "custom") {
    customWrap.classList.remove("hidden");
    const today = iso(new Date());
    if (!$("rangeStart").value) $("rangeStart").value = today;
    if (!$("rangeEnd").value) $("rangeEnd").value = today;
    refresh();
  } else {
    customWrap.classList.add("hidden");
    refresh();
  }
});

$("rangeStart").addEventListener("change", refresh);
$("rangeEnd").addEventListener("change", refresh);

(async function init() {
  await loadCategories();
  await refresh();
})();
