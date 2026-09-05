import { supabase, money, todayISO, defaultPeriod } from "./db.js";

let accountsCache = [];
let categoriesCache = [];
let chosenCategoryId = null;

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

  // "Available to spend" = Bank + TNG only (Cash held out on purpose for now).
  const bank = data.find((a) => a.name === "Bank");
  const tng = data.find((a) => a.name === "TNG Wallet");
  const available = (Number(bank?.balance) || 0) + (Number(tng?.balance) || 0);
  document.getElementById("availableAmount").textContent = money(available);

  populateAccountSelects();
}

function populateAccountSelects() {
  const options = accountsCache
    .map((a) => `<option value="${a.id}">${a.name}</option>`)
    .join("");
  const spendSelect = document.getElementById("spendAccount");
  const incomeSelect = document.getElementById("incomeAccount");
  spendSelect.innerHTML = options;
  incomeSelect.innerHTML = options;

  // Default "From" / "To" to TNG Wallet if it exists.
  const tng = accountsCache.find((a) => a.name === "TNG Wallet");
  if (tng) {
    spendSelect.value = tng.id;
    incomeSelect.value = tng.id;
  }
}

async function loadCategories() {
  const { data, error } = await supabase.from("categories").select("*").order("name");
  if (error) { console.error(error); return; }
  categoriesCache = data;

  const topLevel = data.filter((c) => !c.parent_id);
  document.getElementById("categoryGrid").innerHTML = topLevel
    .map((c) => `<button class="category-btn" data-id="${c.id}" data-name="${c.name}">${c.name}</button>`)
    .join("");

  const incomeCategorySelect = document.getElementById("incomeCategory");
  incomeCategorySelect.innerHTML =
    `<option value="">(none)</option>` +
    data.map((c) => `<option value="${c.id}">${c.name}</option>`).join("");
}

async function loadRecent() {
  const { data, error } = await supabase
    .from("transactions")
    .select("id, date, time_period, type, amount, accounts(name), categories(name)")
    .order("created_at", { ascending: false })
    .limit(6);
  if (error) { console.error(error); return; }

  document.getElementById("recentList").innerHTML = data
    .map((t) => {
      const label = t.categories?.name || (t.type === "income" ? "Income" : "Expense");
      const sign = t.type === "expense" ? "-" : "+";
      const period = t.time_period ? ` · ${t.time_period}` : "";
      return `<li>
        <span>
          <div class="recent-cat">${label}</div>
          <div class="recent-meta">${t.accounts?.name || ""} · ${t.date}${period}</div>
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
  loadCategories(); // reset grid back to top-level each time it opens
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
    document.getElementById("chosenCategoryLabel").textContent = name;
    document.getElementById("spendDate").value = todayISO();
    document.getElementById("spendPeriod").value = defaultPeriod();
    categoryStep.classList.add("hidden");
    amountStep.classList.remove("hidden");
  }
});

document.getElementById("confirmSpend").addEventListener("click", async () => {
  const amount = parseFloat(document.getElementById("spendAmount").value);
  const accountId = document.getElementById("spendAccount").value;
  const date = document.getElementById("spendDate").value || todayISO();
  const timePeriod = document.getElementById("spendPeriod").value;
  if (!amount || amount <= 0) return;

  await supabase.from("transactions").insert({
    date,
    time_period: timePeriod,
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
  document.getElementById("incomeDate").value = todayISO();
  document.getElementById("incomePeriod").value = defaultPeriod();
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
  const date = document.getElementById("incomeDate").value || todayISO();
  const timePeriod = document.getElementById("incomePeriod").value;
  if (!amount || amount <= 0) return;

  await supabase.from("transactions").insert({
    date,
    time_period: timePeriod,
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
