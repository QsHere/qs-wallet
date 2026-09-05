import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const money = (n) => `RM ${Number(n).toFixed(2)}`;
const todayISO = () => new Date().toISOString().slice(0, 10);

let accountsCache = [];
let categoriesCache = [];
let chosenCategoryId = null;
let chosenCategoryName = "";

// ---------- BUDGET MATH ----------
// Week-of-month is defined simply as: day 1-7 = week 1, 8-14 = week 2, etc.
// This is an approximation, not calendar Mon-Sun weeks — easy to change later.
function weekInfo(date) {
  const day = date.getDate();
  const daysInMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  const weekOfMonth = Math.ceil(day / 7);
  const weeksInMonth = Math.ceil(daysInMonth / 7);
  const weekStartDay = (weekOfMonth - 1) * 7 + 1;
  const weekEndDay = Math.min(weekOfMonth * 7, daysInMonth);
  return { weekOfMonth, weeksInMonth, weekStartDay, weekEndDay, daysInMonth };
}

function monthRange(date) {
  const start = new Date(date.getFullYear(), date.getMonth(), 1);
  const end = new Date(date.getFullYear(), date.getMonth() + 1, 0);
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

async function getActiveFixedItems() {
  const today = todayISO();
  const { data, error } = await supabase
    .from("fixed_items")
    .select("*")
    .lte("effective_from", today)
    .order("effective_from", { ascending: true });
  if (error) { console.error(error); return []; }

  // Keep only the most recent row per item name (handles amount changes over time)
  const latestByName = {};
  for (const row of data) {
    latestByName[row.name] = row; // later rows overwrite earlier ones since sorted ascending
  }
  return Object.values(latestByName);
}

async function loadDashboard() {
  const now = new Date();
  const { weekOfMonth, weeksInMonth, weekStartDay, weekEndDay } = weekInfo(now);
  const { start: monthStart, end: monthEnd } = monthRange(now);

  const weekStartISO = new Date(now.getFullYear(), now.getMonth(), weekStartDay).toISOString().slice(0, 10);
  const weekEndISO = new Date(now.getFullYear(), now.getMonth(), weekEndDay).toISOString().slice(0, 10);

  const fixedItems = await getActiveFixedItems();
  const totals = { income: 0, saving: 0, bill: 0 };
  fixedItems.forEach((i) => { totals[i.type] += Number(i.amount); });
  const monthlyDisposable = totals.income - totals.saving - totals.bill;
  const weeklyBudget = monthlyDisposable / weeksInMonth;

  const { data: monthTx } = await supabase
    .from("transactions")
    .select("amount, type, date")
    .gte("date", monthStart)
    .lte("date", monthEnd);

  const monthlySpent = (monthTx || [])
    .filter((t) => t.type === "expense")
    .reduce((sum, t) => sum + Number(t.amount), 0);

  const weeklySpent = (monthTx || [])
    .filter((t) => t.type === "expense" && t.date >= weekStartISO && t.date <= weekEndISO)
    .reduce((sum, t) => sum + Number(t.amount), 0);

  const monthlyRemaining = monthlyDisposable - monthlySpent;
  const weeklyRemaining = weeklyBudget - weeklySpent;

  const monthName = now.toLocaleString("default", { month: "long" });
  document.getElementById("weekLabel").textContent = `Week ${weekOfMonth} of ${monthName}`;
  const heroEl = document.getElementById("weeklyRemaining");
  heroEl.textContent = money(weeklyRemaining);
  heroEl.classList.toggle("negative", weeklyRemaining < 0);
  document.getElementById("monthlyLine").textContent = `This month: ${money(monthlyRemaining)}`;

  await loadBalances();
  await loadRecent();
}

async function loadBalances() {
  const { data, error } = await supabase.from("accounts").select("*").order("name");
  if (error) { console.error(error); return; }
  accountsCache = data;
  const el = document.getElementById("balances");
  el.innerHTML = data.map((a) => `<span>${a.name}: <b>${money(a.balance)}</b></span>`).join("");
  populateAccountSelects();
}

function populateAccountSelects() {
  const options = accountsCache.map((a) => `<option value="${a.id}">${a.name}</option>`).join("");
  document.getElementById("spendAccount").innerHTML = options;
  document.getElementById("incomeAccount").innerHTML = options;
}

async function loadCategories() {
  const { data, error } = await supabase.from("categories").select("*").order("name");
  if (error) { console.error(error); return; }
  categoriesCache = data;

  // Category picker (spend flow): top-level categories only
  const topLevel = data.filter((c) => !c.parent_id);
  document.getElementById("categoryGrid").innerHTML = topLevel
    .map((c) => `<button class="category-btn" data-id="${c.id}" data-name="${c.name}">${c.name}</button>`)
    .join("");

  // Income source dropdown: all categories, optional
  const incomeCategorySelect = document.getElementById("incomeCategory");
  incomeCategorySelect.innerHTML =
    `<option value="">(none)</option>` +
    data.map((c) => `<option value="${c.id}">${c.name}</option>`).join("");
}

async function loadRecent() {
  const { data, error } = await supabase
    .from("transactions")
    .select("id, date, type, amount, note, accounts(name), categories(name)")
    .order("created_at", { ascending: false })
    .limit(6);
  if (error) { console.error(error); return; }

  document.getElementById("recentList").innerHTML = data
    .map((t) => {
      const label = t.categories?.name || (t.type === "income" ? "Income" : "Expense");
      const sign = t.type === "expense" ? "-" : "+";
      return `<li>
        <span>
          <div class="recent-cat">${label}</div>
          <div class="recent-meta">${t.accounts?.name || ""} · ${t.date}</div>
        </span>
        <span class="recent-amt ${t.type}">${sign}${money(t.amount)}</span>
      </li>`;
    })
    .join("");
}

// ---------- SPEND FLOW ----------
const spendOverlay = document.getElementById("spendOverlay");
const categoryStep = document.getElementById("spendCategoryStep");
const amountStep = document.getElementById("spendAmountStep");
const spendBack = document.getElementById("spendBack");
const spendStepTitle = document.getElementById("spendStepTitle");

document.getElementById("openSpend").addEventListener("click", () => {
  categoryStep.classList.remove("hidden");
  amountStep.classList.add("hidden");
  spendBack.style.visibility = "hidden";
  spendStepTitle.textContent = "Pick a category";
  spendOverlay.classList.add("open");
});

document.getElementById("spendClose").addEventListener("click", () => {
  spendOverlay.classList.remove("open");
  document.getElementById("spendAmount").value = "";
});

document.getElementById("categoryGrid").addEventListener("click", (e) => {
  const btn = e.target.closest(".category-btn");
  if (!btn) return;
  const id = btn.dataset.id;
  const name = btn.dataset.name;
  const children = categoriesCache.filter((c) => c.parent_id === id);

  if (children.length > 0) {
    // Show subcategories in the same grid, with a back button
    document.getElementById("categoryGrid").innerHTML = children
      .map((c) => `<button class="category-btn" data-id="${c.id}" data-name="${c.name}">${c.name}</button>`)
      .join("");
    spendStepTitle.textContent = name;
    spendBack.style.visibility = "visible";
    spendBack.onclick = () => loadCategories().then(() => {
      spendStepTitle.textContent = "Pick a category";
      spendBack.style.visibility = "hidden";
    });
  } else {
    chosenCategoryId = id;
    chosenCategoryName = name;
    document.getElementById("chosenCategoryLabel").textContent = name;
    categoryStep.classList.add("hidden");
    amountStep.classList.remove("hidden");
  }
});

document.getElementById("confirmSpend").addEventListener("click", async () => {
  const amount = parseFloat(document.getElementById("spendAmount").value);
  const accountId = document.getElementById("spendAccount").value;
  if (!amount || amount <= 0) return;

  await supabase.from("transactions").insert({
    date: todayISO(),
    type: "expense",
    amount,
    account_id: accountId,
    category_id: chosenCategoryId,
  });

  const account = accountsCache.find((a) => a.id === accountId);
  await supabase.from("accounts").update({ balance: Number(account.balance) - amount }).eq("id", accountId);

  spendOverlay.classList.remove("open");
  document.getElementById("spendAmount").value = "";
  await loadDashboard();
});

// ---------- INCOME FLOW ----------
document.getElementById("openIncome").addEventListener("click", () => {
  document.getElementById("incomeOverlay").classList.add("open");
});

document.getElementById("incomeClose").addEventListener("click", () => {
  document.getElementById("incomeOverlay").classList.remove("open");
  document.getElementById("incomeAmount").value = "";
});

document.getElementById("confirmIncome").addEventListener("click", async () => {
  const amount = parseFloat(document.getElementById("incomeAmount").value);
  const accountId = document.getElementById("incomeAccount").value;
  const categoryId = document.getElementById("incomeCategory").value || null;
  if (!amount || amount <= 0) return;

  await supabase.from("transactions").insert({
    date: todayISO(),
    type: "income",
    amount,
    account_id: accountId,
    category_id: categoryId,
  });

  const account = accountsCache.find((a) => a.id === accountId);
  await supabase.from("accounts").update({ balance: Number(account.balance) + amount }).eq("id", accountId);

  document.getElementById("incomeOverlay").classList.remove("open");
  document.getElementById("incomeAmount").value = "";
  await loadDashboard();
});

// ---------- INIT ----------
(async function init() {
  await loadCategories();
  await loadDashboard();

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(console.error);
  }
})();
