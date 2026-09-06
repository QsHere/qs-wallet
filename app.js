import { supabase, money, todayISO, defaultPeriod } from "./db.js";

let accountsCache = [];
let categoriesCache = [];
let chosenCategoryId = null;

const spendState = { accountId: null, date: todayISO(), period: defaultPeriod() };
const incomeState = { accountId: null, date: todayISO(), period: defaultPeriod() };

function yesterdayISO() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

async function loadDashboard() {
  document.getElementById("todayDate").textContent = new Date().toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  await loadBalances();
  await loadRecent();
}

async function loadBalances() {
  const { data, error } = await supabase.from("accounts").select("*").order("name");
  if (error) { console.error(error); return; }
  accountsCache = data;

  document.getElementById("balances").innerHTML = data
    .map((a) => `<span>${a.name}: <b>${money(a.balance)}</b></span>`)
    .join("");

  const bank = data.find((a) => a.name === "Bank");
  const tng = data.find((a) => a.name === "TNG Wallet");
  const available = (Number(bank?.balance) || 0) + (Number(tng?.balance) || 0);
  document.getElementById("availableAmount").textContent = money(available);

  const defaultAccountId = (tng || data[0])?.id || null;
  spendState.accountId = defaultAccountId;
  incomeState.accountId = defaultAccountId;
  renderAccountPills("spendAccountPills", spendState);
  renderAccountPills("incomeAccountPills", incomeState);
}

function renderAccountPills(containerId, state) {
  const container = document.getElementById(containerId);
  container.innerHTML = accountsCache
    .map((a) => `<button type="button" class="pill ${a.id === state.accountId ? "selected" : ""}" data-account="${a.id}">${a.name}</button>`)
    .join("");
  container.querySelectorAll(".pill").forEach((pill) => {
    pill.addEventListener("click", () => {
      container.querySelectorAll(".pill").forEach((p) => p.classList.remove("selected"));
      pill.classList.add("selected");
      state.accountId = pill.dataset.account;
    });
  });
}

// ---------- Date pills (Today / Yesterday / Other…) — wired once, reset on open ----------
function initDatePills(prefix, state) {
  const pillsContainer = document.getElementById(`${prefix}DatePills`);
  const wrap = document.getElementById(`${prefix}DateWrap`);
  const input = document.getElementById(`${prefix}Date`);
  const pills = pillsContainer.querySelectorAll(".pill");

  pills.forEach((pill) => {
    pill.addEventListener("click", () => {
      pills.forEach((p) => p.classList.remove("selected"));
      pill.classList.add("selected");
      if (pill.dataset.date === "today") {
        state.date = todayISO();
        wrap.classList.add("hidden");
      } else if (pill.dataset.date === "yesterday") {
        state.date = yesterdayISO();
        wrap.classList.add("hidden");
      } else {
        wrap.classList.remove("hidden");
        input.value = state.date;
        input.focus();
      }
    });
  });

  input.addEventListener("change", () => { state.date = input.value; });
}

function resetDatePills(prefix, state) {
  const pillsContainer = document.getElementById(`${prefix}DatePills`);
  const wrap = document.getElementById(`${prefix}DateWrap`);
  const pills = pillsContainer.querySelectorAll(".pill");
  pills.forEach((p) => p.classList.remove("selected"));
  pills[0].classList.add("selected"); // "Today"
  wrap.classList.add("hidden");
  state.date = todayISO();
}

function initPeriodPills(prefix, state) {
  const container = document.getElementById(`${prefix}PeriodPills`);
  const pills = container.querySelectorAll(".pill");
  pills.forEach((pill) => {
    pill.addEventListener("click", () => {
      pills.forEach((p) => p.classList.remove("selected"));
      pill.classList.add("selected");
      state.period = pill.dataset.period;
    });
  });
}

function resetPeriodPills(prefix, state) {
  const container = document.getElementById(`${prefix}PeriodPills`);
  const pills = container.querySelectorAll(".pill");
  const value = defaultPeriod();
  state.period = value;
  pills.forEach((p) => p.classList.toggle("selected", p.dataset.period === value));
}

async function loadCategories() {
  const { data, error } = await supabase.from("categories").select("*").order("name");
  if (error) { console.error(error); return; }
  categoriesCache = data;
  renderCategoryGrid(data.filter((c) => !c.parent_id));
}

function renderCategoryGrid(list) {
  document.getElementById("categoryGrid").innerHTML = list
    .map((c) => `<button class="category-btn" data-id="${c.id}" data-name="${c.name}" data-icon="${c.icon || "🏷️"}">
        <span class="cat-icon">${c.icon || "🏷️"}</span>
        <span>${c.name}</span>
      </button>`)
    .join("");
}

async function loadRecent() {
  const { data, error } = await supabase
    .from("transactions")
    .select("id, date, time_period, type, amount, source, accounts(name), categories(name, icon)")
    .order("created_at", { ascending: false })
    .limit(6);
  if (error) { console.error(error); return; }

  document.getElementById("recentList").innerHTML = data.length
    ? data.map(recentRowHTML).join("")
    : `<li class="empty-note">No transactions yet — tap Spend or Income to add one.</li>`;
}

function recentRowHTML(t) {
  const isIncome = t.type === "income";
  const label = isIncome ? (t.source || "Income") : (t.categories?.name || "Expense");
  const icon = isIncome ? "💰" : (t.categories?.icon || "🏷️");
  const sign = isIncome ? "+" : "-";
  const period = t.time_period ? ` · ${t.time_period}` : "";
  return `<li>
    <span class="recent-left">
      <span class="recent-icon">${icon}</span>
      <span>
        <div class="recent-cat">${label}</div>
        <div class="recent-meta">${t.accounts?.name || ""} · ${t.date}${period}</div>
      </span>
    </span>
    <span class="recent-amt ${t.type}">${sign}${money(t.amount)}</span>
  </li>`;
}

// ---------- MENU SHEET ----------
document.getElementById("openMenu").addEventListener("click", () => {
  document.getElementById("menuOverlay").classList.add("open");
});
document.getElementById("menuOverlay").addEventListener("click", (e) => {
  if (e.target.id === "menuOverlay") document.getElementById("menuOverlay").classList.remove("open");
});

// ---------- SPEND FLOW ----------
const spendOverlay = document.getElementById("spendOverlay");
const categoryStep = document.getElementById("spendCategoryStep");
const amountStep = document.getElementById("spendAmountStep");
const spendBack = document.getElementById("spendBack");
const spendStepTitle = document.getElementById("spendStepTitle");

function openSpendFlow() {
  categoryStep.classList.remove("hidden");
  amountStep.classList.add("hidden");
  spendBack.style.visibility = "hidden";
  spendStepTitle.textContent = "Pick a category";
  spendOverlay.classList.add("open");
  renderCategoryGrid(categoriesCache.filter((c) => !c.parent_id));
}

document.getElementById("openSpend").addEventListener("click", openSpendFlow);

document.getElementById("spendClose").addEventListener("click", () => {
  spendOverlay.classList.remove("open");
  document.getElementById("spendAmount").value = "";
});

document.getElementById("categoryGrid").addEventListener("click", (e) => {
  const btn = e.target.closest(".category-btn");
  if (!btn) return;
  const id = btn.dataset.id;
  const name = btn.dataset.name;
  const icon = btn.dataset.icon;
  const children = categoriesCache.filter((c) => c.parent_id === id);

  if (children.length > 0) {
    renderCategoryGrid(children);
    spendStepTitle.textContent = name;
    spendBack.style.visibility = "visible";
    spendBack.onclick = () => {
      renderCategoryGrid(categoriesCache.filter((c) => !c.parent_id));
      spendStepTitle.textContent = "Pick a category";
      spendBack.style.visibility = "hidden";
    };
  } else {
    chosenCategoryId = id;
    document.getElementById("chosenCategoryLabel").textContent = name;
    document.getElementById("chosenCategoryIcon").textContent = icon;
    categoryStep.classList.add("hidden");
    amountStep.classList.remove("hidden");
    resetDatePills("spend", spendState);
    resetPeriodPills("spend", spendState);
  }
});

document.getElementById("confirmSpend").addEventListener("click", async () => {
  const amount = parseFloat(document.getElementById("spendAmount").value);
  if (!amount || amount <= 0) return;
  const accountId = spendState.accountId;

  await supabase.from("transactions").insert({
    date: spendState.date,
    time_period: spendState.period,
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
function openIncomeFlow() {
  document.getElementById("incomeOverlay").classList.add("open");
  resetDatePills("income", incomeState);
  resetPeriodPills("income", incomeState);
}

document.getElementById("openIncome").addEventListener("click", openIncomeFlow);

document.getElementById("incomeClose").addEventListener("click", () => {
  document.getElementById("incomeOverlay").classList.remove("open");
  document.getElementById("incomeAmount").value = "";
});

document.getElementById("confirmIncome").addEventListener("click", async () => {
  const amount = parseFloat(document.getElementById("incomeAmount").value);
  if (!amount || amount <= 0) return;
  const accountId = incomeState.accountId;
  const source = document.getElementById("incomeSource").value.trim() || null;

  await supabase.from("transactions").insert({
    date: incomeState.date,
    time_period: incomeState.period,
    type: "income",
    amount,
    account_id: accountId,
    source,
  });

  const account = accountsCache.find((a) => a.id === accountId);
  await supabase.from("accounts").update({ balance: Number(account.balance) + amount }).eq("id", accountId);

  document.getElementById("incomeOverlay").classList.remove("open");
  document.getElementById("incomeAmount").value = "";
  document.getElementById("incomeSource").value = "";
  await loadDashboard();
});

// ---------- INIT ----------
(async function init() {
  initDatePills("spend", spendState);
  initPeriodPills("spend", spendState);
  initDatePills("income", incomeState);
  initPeriodPills("income", incomeState);

  await loadCategories();
  await loadDashboard();

  // PWA app-shortcut deep links: index.html?action=spend / ?action=income
  const params = new URLSearchParams(window.location.search);
  if (params.get("action") === "spend") openSpendFlow();
  if (params.get("action") === "income") openIncomeFlow();

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(console.error);
  }
})();
