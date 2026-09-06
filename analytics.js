import { supabase, money, colorFor } from "./db.js";

let categories = [];
let expenses = [];
let path = []; // breadcrumb trail of {id, name}
let currentRange = "week";
let chart;

function iso(d) { return d.toISOString().slice(0, 10); }

function computeRange(key) {
  const now = new Date();
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
  if (key === "last7") {
    const end = new Date(now);
    const start = new Date(now);
    start.setDate(start.getDate() - 6);
    return { start: iso(start), end: iso(end) };
  }
  // last30
  const end = new Date(now);
  const start = new Date(now);
  start.setDate(start.getDate() - 29);
  return { start: iso(start), end: iso(end) };
}

async function loadCategories() {
  const { data, error } = await supabase.from("categories").select("*");
  if (error) { console.error(error); return; }
  categories = data || [];
}

async function loadExpenses(start, end) {
  const { data, error } = await supabase
    .from("transactions")
    .select("amount, category_id")
    .eq("type", "expense")
    .gte("date", start)
    .lte("date", end);
  if (error) { console.error(error); expenses = []; return; }
  expenses = data || [];
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

function uncategorizedTotal() {
  const validIds = new Set(categories.map((c) => c.id));
  return expenses
    .filter((e) => !e.category_id || !validIds.has(e.category_id))
    .reduce((s, e) => s + Number(e.amount), 0);
}

function currentParentId() {
  return path.length ? path[path.length - 1].id : null;
}

function render() {
  const parentId = currentParentId();
  const nodes = childrenOf(parentId);

  let items = nodes
    .map((c) => ({
      id: c.id,
      name: c.name,
      icon: c.icon || "🏷️",
      total: recursiveTotal(c.id),
      hasChildren: childrenOf(c.id).length > 0,
    }))
    .filter((i) => i.total > 0)
    .sort((a, b) => b.total - a.total);

  if (parentId === null) {
    const unc = uncategorizedTotal();
    if (unc > 0) items.push({ id: null, name: "Uncategorized", icon: "🏷️", total: unc, hasChildren: false });
  }

  const total = items.reduce((s, i) => s + i.total, 0);
  document.getElementById("totalAmount").textContent = money(total);
  document.getElementById("totalLabel").textContent = parentId ? `Total in ${path[path.length - 1].name}` : "Total spent";

  renderBreadcrumb();

  const labels = items.map((i) => i.name);
  const values = items.map((i) => i.total);
  const colors = items.map((i) => (i.id ? colorFor(i.name) : "#636366"));

  if (chart) chart.destroy();
  const ctx = document.getElementById("pieChart").getContext("2d");
  chart = new Chart(ctx, {
    type: "pie",
    data: { labels, datasets: [{ data: values, backgroundColor: colors, borderColor: "#000000", borderWidth: 2 }] },
    options: {
      plugins: { legend: { display: false } },
      onClick: (evt, elements) => {
        if (!elements.length) return;
        const item = items[elements[0].index];
        if (item.hasChildren) drillInto(item);
      },
    },
  });

  document.getElementById("legendList").innerHTML = items.length
    ? items
        .map((item, i) => {
          const pct = total ? Math.round((item.total / total) * 100) : 0;
          return `<li class="${item.hasChildren ? "tappable" : ""}" data-idx="${i}">
            <span class="row-left">
              <span class="tile-mini" style="background:${colors[i]}33">${item.icon}</span>
              <span class="row-title">${item.name}${item.hasChildren ? " ›" : ""}</span>
            </span>
            <span class="row-amt" style="color:${colors[i]}">${money(item.total)} · ${pct}%</span>
          </li>`;
        })
        .join("")
    : `<li class="empty-note">No expenses in this period.</li>`;

  document.getElementById("legendList").querySelectorAll("[data-idx]").forEach((li) => {
    li.addEventListener("click", () => {
      const item = items[Number(li.dataset.idx)];
      if (item.hasChildren) drillInto(item);
    });
  });
}

function drillInto(item) {
  path.push({ id: item.id, name: item.name });
  render();
}

function renderBreadcrumb() {
  const el = document.getElementById("breadcrumb");
  const crumbs = [`<a data-crumb="-1">All</a>`, ...path.map((p, i) => `<a data-crumb="${i}">${p.name}</a>`)];
  el.innerHTML = crumbs.join(' <span class="crumb-sep">›</span> ');
  el.querySelectorAll("[data-crumb]").forEach((a) => {
    a.addEventListener("click", () => {
      const idx = Number(a.dataset.crumb);
      path = idx === -1 ? [] : path.slice(0, idx + 1);
      render();
    });
  });
}

async function refresh() {
  let start, end;
  if (currentRange === "custom") {
    start = document.getElementById("rangeStart").value;
    end = document.getElementById("rangeEnd").value;
    if (!start || !end) return;
  } else {
    ({ start, end } = computeRange(currentRange));
  }
  await loadExpenses(start, end);
  path = [];
  render();
}

document.getElementById("rangePills").addEventListener("click", (e) => {
  const btn = e.target.closest(".pill");
  if (!btn) return;
  document.querySelectorAll("#rangePills .pill").forEach((p) => p.classList.remove("selected"));
  btn.classList.add("selected");
  currentRange = btn.dataset.range;
  const customWrap = document.getElementById("customRangeWrap");
  if (currentRange === "custom") {
    customWrap.classList.remove("hidden");
    const today = iso(new Date());
    if (!document.getElementById("rangeStart").value) document.getElementById("rangeStart").value = today;
    if (!document.getElementById("rangeEnd").value) document.getElementById("rangeEnd").value = today;
    refresh();
  } else {
    customWrap.classList.add("hidden");
    refresh();
  }
});

document.getElementById("rangeStart").addEventListener("change", refresh);
document.getElementById("rangeEnd").addEventListener("change", refresh);

(async function init() {
  await loadCategories();
  await refresh();
})();
