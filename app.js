import { supabase, money, todayISO, defaultPeriod, colorFor, animateNumber } from "./db.js";

let accountsCache = [];
let categoriesCache = [];
let recentCache = [];
let chosenCategoryId = null;
let hideBalance = localStorage.getItem("qs-hide-balance") === "1";

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
  await loadDebtsSummary();
}

async function loadDebtsSummary() {
  const { data, error } = await supabase.from("debts").select("direction, balance");
  if (error) { console.error(error); return; }
  const owedToYou = data.filter((d) => d.direction === "owed_to_me").reduce((s, d) => s + Number(d.balance), 0);
  const youOwe = data.filter((d) => d.direction === "i_owe").reduce((s, d) => s + Number(d.balance), 0);
  const el = document.getElementById("debtsSummary");
  if (owedToYou === 0 && youOwe === 0) { el.innerHTML = ""; return; }
  el.innerHTML = `<a href="debts.html">🤝 Owed to you: <b class="owed-to-you">${money(owedToYou)}</b> · You owe: <b class="you-owe">${money(youOwe)}</b></a>`;
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
  const heroEl = document.getElementById("availableAmount");
  heroEl.classList.toggle("negative", available < 0);
  heroEl.dataset.rawValue = available;
  renderHero();

  const defaultAccountId = (tng || data[0])?.id || null;
  spendState.accountId = defaultAccountId;
  incomeState.accountId = defaultAccountId;
  renderAccountPills("spendAccountPills", spendState);
  renderAccountPills("incomeAccountPills", incomeState);
}

function renderHero() {
  const heroEl = document.getElementById("availableAmount");
  const value = Number(heroEl.dataset.rawValue || 0);
  if (hideBalance) {
    heroEl.textContent = "RM ••••";
  } else {
    animateNumber(heroEl, value);
  }
  document.getElementById("eyeIcon").innerHTML = hideBalance
    ? `<path d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-7 0-11-8-11-8a21.6 21.6 0 0 1 5.06-6.06M9.9 4.24A10.94 10.94 0 0 1 12 4c7 0 11 8 11 8a21.6 21.6 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>`
    : `<path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/>`;
}

document.getElementById("toggleVisibility").addEventListener("click", () => {
  hideBalance = !hideBalance;
  localStorage.setItem("qs-hide-balance", hideBalance ? "1" : "0");
  renderHero();
});

document.getElementById("toggleAccounts").addEventListener("click", () => {
  document.getElementById("toggleAccounts").classList.toggle("expanded");
  document.getElementById("accountsCollapse").classList.toggle("expanded");
});

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
        <span class="category-tile" style="background:${colorFor(c.name)}33">${c.icon || "🏷️"}</span>
        <span class="cat-label">${c.name}</span>
      </button>`)
    .join("");
}

async function loadRecent() {
  const { data, error } = await supabase
    .from("transactions")
    .select("id, date, time_period, type, amount, source, note, account_id, category_id, accounts(name), categories(name, icon)")
    .order("created_at", { ascending: false })
    .limit(5);
  if (error) { console.error(error); return; }
  recentCache = data;

  document.getElementById("recentList").innerHTML = data.length
    ? data.map(recentRowHTML).join("")
    : `<li class="empty-note">No transactions yet — tap Spend or Income to add one.</li>`;
}

function recentRowHTML(t) {
  const isIncome = t.type === "income";
  const label = isIncome ? (t.source || "Income") : (t.categories?.name || "Expense");
  const icon = isIncome ? "💰" : (t.categories?.icon || "🏷️");
  const tint = isIncome ? "#30D15833" : colorFor(label) + "33";
  const sign = isIncome ? "+" : "-";
  return `<li class="tappable" data-id="${t.id}">
    <span class="recent-left">
      <span class="recent-icon" style="background:${tint}">${icon}</span>
      <span class="recent-cat">${label}</span>
    </span>
    <span class="recent-amt ${t.type}">${sign}${money(t.amount)}</span>
  </li>`;
}

// ---------- TRANSACTION DETAIL SHEET ----------
let activeDetailId = null;

document.getElementById("recentList").addEventListener("click", (e) => {
  const row = e.target.closest("[data-id]");
  if (!row) return;
  openDetail(row.dataset.id);
});

function openDetail(id) {
  const t = recentCache.find((x) => x.id === id);
  if (!t) return;
  activeDetailId = id;
  const isIncome = t.type === "income";
  const label = isIncome ? (t.source || "Income") : (t.categories?.name || "Expense");
  const icon = isIncome ? "💰" : (t.categories?.icon || "🏷️");
  const tint = isIncome ? "#30D15833" : colorFor(label) + "33";

  document.getElementById("detailIcon").textContent = icon;
  document.getElementById("detailIconWrap").style.background = tint;
  const amtEl = document.getElementById("detailAmount");
  amtEl.textContent = `${isIncome ? "+" : "-"}${money(t.amount)}`;
  amtEl.className = `detail-amount ${t.type}`;

  document.getElementById("detailCategory").textContent = label;
  document.getElementById("detailAccount").textContent = t.accounts?.name || "—";
  document.getElementById("detailDate").textContent = t.date;
  document.getElementById("detailPeriod").textContent = t.time_period || "—";

  const noteRow = document.getElementById("detailNoteRow");
  if (t.note) {
    noteRow.classList.remove("hidden");
    document.getElementById("detailNote").textContent = t.note;
  } else {
    noteRow.classList.add("hidden");
  }

  document.getElementById("detailEditRow").classList.add("hidden");
  document.getElementById("detailEditDateWrap").classList.add("hidden");
  document.getElementById("detailSaveEdit").classList.add("hidden");
  document.getElementById("detailEditToggle").classList.remove("hidden");
  document.getElementById("detailEditAmount").value = t.amount;
  document.getElementById("detailEditDate").value = t.date;

  document.getElementById("detailOverlay").classList.add("open");
}

document.getElementById("detailClose").addEventListener("click", () => {
  document.getElementById("detailOverlay").classList.remove("open");
});

document.getElementById("detailEditToggle").addEventListener("click", () => {
  document.getElementById("detailEditRow").classList.remove("hidden");
  document.getElementById("detailEditDateWrap").classList.remove("hidden");
  document.getElementById("detailSaveEdit").classList.remove("hidden");
  document.getElementById("detailEditToggle").classList.add("hidden");
});

document.getElementById("detailSaveEdit").addEventListener("click", async () => {
  const t = recentCache.find((x) => x.id === activeDetailId);
  const newAmount = parseFloat(document.getElementById("detailEditAmount").value);
  const newDate = document.getElementById("detailEditDate").value;
  if (!newAmount || newAmount <= 0 || !newDate) return;

  const diff = newAmount - Number(t.amount);
  const { data: account } = await supabase.from("accounts").select("*").eq("id", t.account_id).single();
  const balanceDelta = t.type === "expense" ? -diff : diff;
  await supabase.from("accounts").update({ balance: Number(account.balance) + balanceDelta }).eq("id", t.account_id);
  await supabase.from("transactions").update({ amount: newAmount, date: newDate }).eq("id", activeDetailId);

  document.getElementById("detailOverlay").classList.remove("open");
  await loadDashboard();
});

document.getElementById("detailDelete").addEventListener("click", async () => {
  const ok = confirm("Delete this transaction? This will also reverse its effect on the account balance.");
  if (!ok) return;

  const t = recentCache.find((x) => x.id === activeDetailId);
  const { data: account } = await supabase.from("accounts").select("*").eq("id", t.account_id).single();
  const revert = t.type === "expense" ? Number(t.amount) : -Number(t.amount);
  await supabase.from("accounts").update({ balance: Number(account.balance) + revert }).eq("id", t.account_id);
  await supabase.from("transactions").delete().eq("id", activeDetailId);

  document.getElementById("detailOverlay").classList.remove("open");
  await loadDashboard();
});

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
    document.getElementById("chosenCategoryIconWrap").style.background = colorFor(name) + "33";
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
  const note = document.getElementById("spendNote").value.trim() || null;

  await supabase.from("transactions").insert({
    date: spendState.date,
    time_period: spendState.period,
    type: "expense",
    amount,
    account_id: accountId,
    category_id: chosenCategoryId,
    note,
  });

  const account = accountsCache.find((a) => a.id === accountId);
  await supabase.from("accounts").update({ balance: Number(account.balance) - amount }).eq("id", accountId);

  spendOverlay.classList.remove("open");
  document.getElementById("spendAmount").value = "";
  document.getElementById("spendNote").value = "";
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
