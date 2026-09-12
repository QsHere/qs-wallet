import { supabase, money, todayISO, attachSwipeToDismiss, enableTabSwipe } from "./db.js";

const SWATCHES = [
  ["#0A84FF", "#5E5CE6"],
  ["#FF9F0A", "#FF375F"],
  ["#30D158", "#0A84FF"],
  ["#FF375F", "#FF9F0A"],
  ["#2C2C2E", "#000000"],
  ["#BF5AF2", "#FF375F"],
];

let cards = [];
let accounts = [];
let activeIndex = 0;
let editingCardId = null;
let chosenColor = SWATCHES[0];
let topUpState = { accountId: null, date: todayISO() };
let cardSpendState = { date: todayISO() };
let currentLog = [];
let activeLogEntry = null;

function yesterdayISO() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

function activeCard() {
  return cards[activeIndex] || null;
}

async function loadAll() {
  const [{ data: cardData, error: cardErr }, { data: accData, error: accErr }] = await Promise.all([
    supabase.from("cards").select("*").order("created_at", { ascending: true }),
    supabase.from("accounts").select("*").order("name"),
  ]);
  if (cardErr) console.error(cardErr);
  if (accErr) console.error(accErr);
  cards = cardData || [];
  accounts = accData || [];
  if (activeIndex >= cards.length) activeIndex = Math.max(0, cards.length - 1);
  renderStack();
  renderDots();
  renderActionsAndMeta();
  if (activeCard()) await loadLog(activeCard().id);
  else document.getElementById("cardActivityLog").innerHTML = `<li class="empty-note">Add a card to get started.</li>`;
}

function renderStack() {
  const stack = document.getElementById("cardStack");
  if (!cards.length) {
    stack.innerHTML = `<div class="card-empty-slate">No cards yet — tap + to add one</div>`;
    return;
  }
  stack.innerHTML = cards.map((c, i) => cardHTML(c, i)).join("");
}

function cardHTML(c, i) {
  const expiry = c.expiry_date ? new Date(c.expiry_date + "T00:00:00").toLocaleDateString("en-GB", { month: "2-digit", year: "2-digit" }) : "";
  return `<div class="virtual-card" data-index="${i}" style="background: linear-gradient(135deg, ${c.color_from}, ${c.color_to}); animation-delay: ${i * 0.06}s;">
    <div class="card-top">
      <div>
        <div class="card-name">${c.name}</div>
        ${c.description ? `<div class="card-desc">${c.description}</div>` : ""}
      </div>
      <div class="card-chip">💳</div>
    </div>
    <div class="card-bottom">
      <div>
        ${c.has_balance
          ? `<div class="card-balance-label">Balance</div><div class="card-balance">${money(c.balance)}</div>`
          : `<div class="card-balance-label">Reference card</div>`}
      </div>
      ${expiry ? `<div class="card-expiry">Exp ${expiry}</div>` : ""}
    </div>
  </div>`;
}

function renderDots() {
  document.getElementById("cardDots").innerHTML = cards
    .map((_, i) => `<span class="card-dot ${i === activeIndex ? "active" : ""}"></span>`)
    .join("");
}

function renderActionsAndMeta() {
  const c = activeCard();
  const actions = document.getElementById("cardActions");
  const meta = document.getElementById("cardMeta");
  if (!c) { actions.classList.add("hidden"); meta.textContent = ""; return; }

  if (c.has_balance) {
    actions.classList.remove("hidden");
  } else {
    actions.classList.add("hidden");
  }
  meta.textContent = c.expiry_date ? `Expires ${c.expiry_date}` : (c.has_balance ? "" : "No transactions tracked for this card");
}

// ---------- Carousel: track active card as user scrolls ----------
const stackEl = document.getElementById("cardStack");
let scrollDebounce;
stackEl.addEventListener("scroll", () => {
  clearTimeout(scrollDebounce);
  scrollDebounce = setTimeout(() => {
    const cardEls = [...stackEl.querySelectorAll(".virtual-card")];
    if (!cardEls.length) return;
    const stackRect = stackEl.getBoundingClientRect();
    const center = stackRect.left + stackRect.width / 2;
    let closest = 0, closestDist = Infinity;
    cardEls.forEach((el, i) => {
      const r = el.getBoundingClientRect();
      const dist = Math.abs((r.left + r.width / 2) - center);
      if (dist < closestDist) { closestDist = dist; closest = i; }
    });
    if (closest !== activeIndex) {
      activeIndex = closest;
      renderDots();
      renderActionsAndMeta();
      loadLog(activeCard().id);
    }
  }, 100);
}, { passive: true });

// ---------- Add / Edit card ----------
function renderSwatches() {
  document.getElementById("cardSwatches").innerHTML = SWATCHES
    .map(([f, t], i) => `<span class="swatch ${f === chosenColor[0] && t === chosenColor[1] ? "selected" : ""}" data-i="${i}" style="background:linear-gradient(135deg, ${f}, ${t})"></span>`)
    .join("");
  document.querySelectorAll(".swatch").forEach((sw) => {
    sw.addEventListener("click", () => {
      chosenColor = SWATCHES[Number(sw.dataset.i)];
      renderSwatches();
    });
  });
}

function setHasBalance(val) {
  document.getElementById("cardHasBalanceYes").classList.toggle("selected", val);
  document.getElementById("cardHasBalanceNo").classList.toggle("selected", !val);
  document.getElementById("cardInitialBalanceWrap").classList.toggle("hidden", !val);
}
document.getElementById("cardHasBalanceYes").addEventListener("click", () => setHasBalance(true));
document.getElementById("cardHasBalanceNo").addEventListener("click", () => setHasBalance(false));

document.getElementById("openAddCard").addEventListener("click", () => {
  editingCardId = null;
  chosenColor = SWATCHES[cards.length % SWATCHES.length];
  document.getElementById("cardFormTitle").textContent = "Add card";
  document.getElementById("cardName").value = "";
  document.getElementById("cardDescription").value = "";
  document.getElementById("cardExpiry").value = "";
  document.getElementById("cardInitialBalance").value = "";
  document.getElementById("deleteCard").classList.add("hidden");
  document.getElementById("cardInitialBalanceWrap").classList.remove("hidden");
  setHasBalance(true);
  renderSwatches();
  document.getElementById("cardFormOverlay").classList.add("open");
});

document.getElementById("editCardBtn").addEventListener("click", () => {
  const c = activeCard();
  if (!c) return;
  editingCardId = c.id;
  chosenColor = [c.color_from, c.color_to];
  document.getElementById("cardFormTitle").textContent = "Edit card";
  document.getElementById("cardName").value = c.name;
  document.getElementById("cardDescription").value = c.description || "";
  document.getElementById("cardExpiry").value = c.expiry_date || "";
  document.getElementById("cardInitialBalanceWrap").classList.add("hidden"); // balance managed via top-up/spend after creation
  document.getElementById("deleteCard").classList.remove("hidden");
  setHasBalance(c.has_balance);
  renderSwatches();
  document.getElementById("cardFormOverlay").classList.add("open");
});

document.getElementById("cardFormClose").addEventListener("click", () => {
  document.getElementById("cardFormOverlay").classList.remove("open");
});

document.getElementById("saveCard").addEventListener("click", async () => {
  const name = document.getElementById("cardName").value.trim();
  if (!name) return;
  const description = document.getElementById("cardDescription").value.trim() || null;
  const expiry_date = document.getElementById("cardExpiry").value || null;
  const has_balance = document.getElementById("cardHasBalanceYes").classList.contains("selected");

  if (editingCardId) {
    await supabase.from("cards").update({
      name, description, expiry_date, has_balance,
      color_from: chosenColor[0], color_to: chosenColor[1],
    }).eq("id", editingCardId);
  } else {
    const balance = has_balance ? (parseFloat(document.getElementById("cardInitialBalance").value) || 0) : 0;
    await supabase.from("cards").insert({
      name, description, expiry_date, has_balance, balance,
      color_from: chosenColor[0], color_to: chosenColor[1],
    });
  }

  document.getElementById("cardFormOverlay").classList.remove("open");
  await loadAll();
});

document.getElementById("deleteCard").addEventListener("click", async () => {
  if (!editingCardId) return;
  const ok = confirm("Delete this card? Its activity log will be deleted too.");
  if (!ok) return;
  await supabase.from("cards").delete().eq("id", editingCardId);
  document.getElementById("cardFormOverlay").classList.remove("open");
  activeIndex = 0;
  await loadAll();
});

// ---------- Top up ----------
document.getElementById("cardTopUp").addEventListener("click", () => {
  const c = activeCard();
  if (!c) return;
  document.getElementById("topUpTitle").textContent = `Top up ${c.name}`;
  document.getElementById("topUpAmount").value = "";

  const defaultAcc = accounts.find((a) => a.name === "TNG Wallet") || accounts[0];
  topUpState.accountId = defaultAcc?.id || null;
  const container = document.getElementById("topUpAccountPills");
  container.innerHTML = accounts
    .map((a) => `<button type="button" class="pill ${a.id === topUpState.accountId ? "selected" : ""}" data-account="${a.id}">${a.name}</button>`)
    .join("");
  container.querySelectorAll(".pill").forEach((pill) => {
    pill.addEventListener("click", () => {
      container.querySelectorAll(".pill").forEach((p) => p.classList.remove("selected"));
      pill.classList.add("selected");
      topUpState.accountId = pill.dataset.account;
    });
  });

  resetDatePills("topUp", topUpState);
  document.getElementById("topUpOverlay").classList.add("open");
});

document.getElementById("topUpClose").addEventListener("click", () => {
  document.getElementById("topUpOverlay").classList.remove("open");
});

document.getElementById("confirmTopUp").addEventListener("click", async () => {
  const amount = parseFloat(document.getElementById("topUpAmount").value);
  if (!amount || amount <= 0) return;
  const c = activeCard();
  const accountId = topUpState.accountId;
  const account = accounts.find((a) => a.id === accountId);
  if (!c || !account) return;

  const { data: tx } = await supabase.from("transactions").insert({
    date: topUpState.date, type: "expense", amount, account_id: accountId,
    note: `Top up: ${c.name}`,
  }).select().single();

  await supabase.from("accounts").update({ balance: Number(account.balance) - amount }).eq("id", accountId);
  await supabase.from("cards").update({ balance: Number(c.balance) + amount }).eq("id", c.id);
  await supabase.from("card_activity").insert({
    card_id: c.id, date: topUpState.date, type: "topup", amount,
    transaction_id: tx?.id || null, account_id: accountId,
  });

  document.getElementById("topUpOverlay").classList.remove("open");
  await loadAll();
});

// ---------- Card spend ----------
function openCardSpendFlow() {
  const c = activeCard();
  if (!c) return;
  document.getElementById("cardSpendTitle").textContent = `Spend from ${c.name}`;
  document.getElementById("cardSpendAmount").value = "";
  document.getElementById("cardSpendDetail").value = "";
  resetDatePills("cardSpend", cardSpendState);
  document.getElementById("cardSpendOverlay").classList.add("open");
}
document.getElementById("cardSpendBtn").addEventListener("click", openCardSpendFlow);

document.getElementById("cardSpendClose").addEventListener("click", () => {
  document.getElementById("cardSpendOverlay").classList.remove("open");
});

document.getElementById("confirmCardSpend").addEventListener("click", async () => {
  const amount = parseFloat(document.getElementById("cardSpendAmount").value);
  const detail = document.getElementById("cardSpendDetail").value.trim() || null;
  const c = activeCard();
  if (!amount || amount <= 0 || !c) return;

  if (amount > Number(c.balance)) {
    alert(`Insufficient card balance. ${c.name} only has ${money(c.balance)} left.`);
    return;
  }

  await supabase.from("cards").update({ balance: Number(c.balance) - amount }).eq("id", c.id);
  await supabase.from("card_activity").insert({
    card_id: c.id, date: cardSpendState.date, type: "spend", amount, detail,
  });

  document.getElementById("cardSpendOverlay").classList.remove("open");
  await loadAll();
});

// ---------- Shared date-pill helper (Today / Yesterday / Other…) ----------
function resetDatePills(prefix, state) {
  const pillsContainer = document.getElementById(`${prefix}DatePills`);
  const wrap = document.getElementById(`${prefix}DateWrap`);
  const pills = pillsContainer.querySelectorAll(".pill");
  pills.forEach((p) => p.classList.remove("selected"));
  pills[0].classList.add("selected");
  wrap.classList.add("hidden");
  state.date = todayISO();
}

function initDatePills(prefix, state) {
  const pillsContainer = document.getElementById(`${prefix}DatePills`);
  const wrap = document.getElementById(`${prefix}DateWrap`);
  const input = document.getElementById(`${prefix}Date`);
  const pills = pillsContainer.querySelectorAll(".pill");
  pills.forEach((pill) => {
    pill.addEventListener("click", () => {
      pills.forEach((p) => p.classList.remove("selected"));
      pill.classList.add("selected");
      if (pill.dataset.date === "today") { state.date = todayISO(); wrap.classList.add("hidden"); }
      else if (pill.dataset.date === "yesterday") { state.date = yesterdayISO(); wrap.classList.add("hidden"); }
      else { wrap.classList.remove("hidden"); input.value = state.date; }
    });
  });
  input.addEventListener("change", () => { state.date = input.value; });
}
initDatePills("topUp", topUpState);
initDatePills("cardSpend", cardSpendState);

// ---------- Activity log ----------
async function loadLog(cardId) {
  const logEl = document.getElementById("cardActivityLog");
  const { data, error } = await supabase
    .from("card_activity")
    .select("*")
    .eq("card_id", cardId)
    .order("date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(30);
  if (error) { console.error(error); return; }
  currentLog = data || [];
  logEl.innerHTML = currentLog.length ? currentLog.map(logRowHTML).join("") : `<li class="empty-note">No activity yet.</li>`;
}

function logRowHTML(a) {
  const isTopup = a.type === "topup";
  const label = isTopup ? "Top up" : (a.detail || "Spend");
  const sign = isTopup ? "+" : "-";
  const tint = isTopup ? "#30D15833" : "#FF453A33";
  return `<li class="tappable" data-log-id="${a.id}">
    <span class="row-left">
      <span class="row-icon" style="background:${tint}">${isTopup ? "↑" : "↓"}</span>
      <span>
        <div class="row-title">${label}</div>
        <div class="row-meta">${a.date}</div>
      </span>
    </span>
    <span class="row-amt ${isTopup ? "income" : "expense"}">${sign}${money(a.amount)}</span>
  </li>`;
}

document.getElementById("cardActivityLog").addEventListener("click", (e) => {
  const row = e.target.closest("[data-log-id]");
  if (!row) return;
  const entry = currentLog.find((x) => x.id === row.dataset.logId);
  if (!entry) return;
  activeLogEntry = entry;
  document.getElementById("cardLogEditTitle").textContent = entry.type === "topup" ? "Top up" : (entry.detail || "Spend");
  document.getElementById("cardLogEditAmount").value = entry.amount;
  document.getElementById("cardLogEditDate").value = entry.date;
  document.getElementById("cardLogEditHint").textContent = entry.type === "topup"
    ? "Editing or deleting this also updates the linked account balance and transaction."
    : "This only affects the card's own balance — no account is linked to this entry.";
  document.getElementById("cardLogEditOverlay").classList.add("open");
});

document.getElementById("cardLogEditClose").addEventListener("click", () => {
  document.getElementById("cardLogEditOverlay").classList.remove("open");
});

document.getElementById("cardLogEditSave").addEventListener("click", async () => {
  const entry = activeLogEntry;
  if (!entry) return;
  const newAmount = parseFloat(document.getElementById("cardLogEditAmount").value);
  const newDate = document.getElementById("cardLogEditDate").value;
  if (!newAmount || newAmount <= 0 || !newDate) return;

  const c = cards.find((x) => x.id === entry.card_id);
  const diff = newAmount - Number(entry.amount);

  if (entry.type === "spend") {
    await supabase.from("cards").update({ balance: Number(c.balance) - diff }).eq("id", c.id);
  } else {
    // topup: bigger top-up means more added to card, more taken from account
    await supabase.from("cards").update({ balance: Number(c.balance) + diff }).eq("id", c.id);
    if (entry.account_id) {
      const { data: account } = await supabase.from("accounts").select("*").eq("id", entry.account_id).single();
      if (account) await supabase.from("accounts").update({ balance: Number(account.balance) - diff }).eq("id", entry.account_id);
    }
    if (entry.transaction_id) {
      await supabase.from("transactions").update({ amount: newAmount, date: newDate }).eq("id", entry.transaction_id);
    }
  }

  await supabase.from("card_activity").update({ amount: newAmount, date: newDate }).eq("id", entry.id);
  document.getElementById("cardLogEditOverlay").classList.remove("open");
  await loadAll();
});

document.getElementById("cardLogEditDelete").addEventListener("click", async () => {
  const entry = activeLogEntry;
  if (!entry) return;
  const ok = confirm("Delete this activity? Balances will be adjusted back.");
  if (!ok) return;

  const c = cards.find((x) => x.id === entry.card_id);

  if (entry.type === "spend") {
    await supabase.from("cards").update({ balance: Number(c.balance) + Number(entry.amount) }).eq("id", c.id);
  } else {
    await supabase.from("cards").update({ balance: Math.max(0, Number(c.balance) - Number(entry.amount)) }).eq("id", c.id);
    if (entry.account_id) {
      const { data: account } = await supabase.from("accounts").select("*").eq("id", entry.account_id).single();
      if (account) await supabase.from("accounts").update({ balance: Number(account.balance) + Number(entry.amount) }).eq("id", entry.account_id);
    }
    if (entry.transaction_id) {
      await supabase.from("transactions").delete().eq("id", entry.transaction_id);
    }
  }

  await supabase.from("card_activity").delete().eq("id", entry.id);
  document.getElementById("cardLogEditOverlay").classList.remove("open");
  await loadAll();
});

// ---------- Swipe down to dismiss any open sheet ----------
["cardFormOverlay", "topUpOverlay", "cardSpendOverlay", "cardLogEditOverlay"].forEach((id) => {
  const overlay = document.getElementById(id);
  attachSwipeToDismiss(overlay, overlay.querySelector(".sheet-handle"), () => overlay.classList.remove("open"));
});

// Tab-swipe only outside the card carousel (which has its own horizontal scroll)
enableTabSwipe({ prev: "history.html", next: "debts.html", scope: "#cardActivitySection, .page-heading, .card-actions, .card-meta-row" });

// ---------- Init ----------
(async function init() {
  await loadAll();
  const params = new URLSearchParams(window.location.search);
  if (params.get("action") === "spend" && activeCard() && activeCard().has_balance) {
    openCardSpendFlow();
  }
})();
