import { supabase, money, todayISO, colorFor, attachSwipeToDismiss, enableTabSwipe } from "./db.js";

let debts = [];
let accounts = [];
let activeDebtId = null;
let activeLogEntry = null;
let currentLog = [];
let addDirection = "owed_to_me";
let paymentState = { accountId: null, date: todayISO() };
let hideAmounts = localStorage.getItem("qs-hide-balance") === "1";

function maskedMoney(v) { return hideAmounts ? "RM ••••" : money(v); }

function yesterdayISO() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

async function loadAll() {
  const [{ data: debtData, error: debtErr }, { data: accData, error: accErr }] = await Promise.all([
    supabase.from("debts").select("*").order("created_at", { ascending: false }),
    supabase.from("accounts").select("*").order("name"),
  ]);
  if (debtErr) console.error(debtErr);
  if (accErr) console.error(accErr);
  debts = debtData || [];
  accounts = accData || [];
  render();
}

function render() {
  const owed = debts.filter((d) => d.direction === "owed_to_me");
  const owe = debts.filter((d) => d.direction === "i_owe");

  document.getElementById("owedList").innerHTML = owed.length
    ? owed.map((d) => rowHTML(d, "owed")).join("")
    : `<li class="empty-note">Nobody owes you anything right now.</li>`;

  document.getElementById("oweList").innerHTML = owe.length
    ? owe.map((d) => rowHTML(d, "owe")).join("")
    : `<li class="empty-note">You don't owe anyone right now.</li>`;

  const totalOwed = owed.reduce((s, d) => s + Number(d.balance), 0);
  const totalOwe = owe.reduce((s, d) => s + Number(d.balance), 0);
  const net = totalOwed - totalOwe;
  const netEl = document.getElementById("netNumber");
  netEl.textContent = maskedMoney(Math.abs(net));
  netEl.classList.toggle("positive", net >= 0);
  netEl.classList.toggle("negative", net < 0);
  document.getElementById("netLabel").textContent = net >= 0 ? "Net: owed to you overall" : "Net: you owe overall";

  document.getElementById("debtEyeIcon").innerHTML = hideAmounts
    ? `<path d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-7 0-11-8-11-8a21.6 21.6 0 0 1 5.06-6.06M9.9 4.24A10.94 10.94 0 0 1 12 4c7 0 11 8 11 8a21.6 21.6 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>`
    : `<path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/>`;
}

document.getElementById("toggleDebtVisibility").addEventListener("click", () => {
  hideAmounts = !hideAmounts;
  localStorage.setItem("qs-hide-balance", hideAmounts ? "1" : "0");
  render();
});

function rowHTML(d, kind) {
  return `<li class="tappable" data-id="${d.id}">
    <span class="row-left">
      <span class="row-icon" style="background:${colorFor(d.person)}33">${d.person.slice(0, 1).toUpperCase()}</span>
      <span>
        <div class="row-title">${d.person}</div>
        ${d.note ? `<div class="row-meta">${d.note}</div>` : ""}
      </span>
    </span>
    <span class="row-amt ${kind}">${maskedMoney(d.balance)}</span>
  </li>`;
}

// ---------- Row tap → action sheet ----------
function wireListClicks(listId) {
  document.getElementById(listId).addEventListener("click", (e) => {
    const row = e.target.closest("[data-id]");
    if (!row) return;
    openActionSheet(row.dataset.id);
  });
}
wireListClicks("owedList");
wireListClicks("oweList");

function openActionSheet(id) {
  activeDebtId = id;
  const d = debts.find((x) => x.id === id);
  document.getElementById("debtActionTitle").textContent = d.person;
  const label = d.direction === "owed_to_me" ? "owes you" : "you owe";
  document.getElementById("debtActionBalance").textContent = `${label} ${maskedMoney(d.balance)}`;
  document.getElementById("debtActionOverlay").classList.add("open");
  loadLog(id);
}

async function loadLog(debtId) {
  const logEl = document.getElementById("debtLog");
  logEl.innerHTML = `<li class="empty-note">Loading…</li>`;
  const { data, error } = await supabase
    .from("debt_activity")
    .select("*")
    .eq("debt_id", debtId)
    .order("date", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) { console.error(error); logEl.innerHTML = `<li class="empty-note">Couldn't load activity.</li>`; return; }

  currentLog = data || [];
  logEl.innerHTML = currentLog.length
    ? currentLog.map(logRowHTML).join("")
    : `<li class="empty-note">No activity logged yet.</li>`;
}

function logRowHTML(a) {
  const labels = { payment: "Payment", increase: "Added to balance", created: "Debt created" };
  const label = labels[a.type] || a.type;
  const sign = a.type === "payment" ? "-" : "+";
  const tint = a.type === "payment" ? "#30D15833" : "#0A84FF33";
  const editable = a.type !== "created";
  return `<li class="${editable ? "tappable" : ""}" ${editable ? `data-log-id="${a.id}"` : ""}>
    <span class="row-left">
      <span class="row-icon" style="background:${tint}">${a.type === "payment" ? "💸" : "➕"}</span>
      <span>
        <div class="row-title">${label}</div>
        <div class="row-meta">${a.date}${editable ? "" : " · locked"}</div>
      </span>
    </span>
    <span class="row-amt">${sign}${maskedMoney(a.amount)}</span>
  </li>`;
}

document.getElementById("debtLog").addEventListener("click", (e) => {
  const row = e.target.closest("[data-log-id]");
  if (!row) return;
  openLogEdit(row.dataset.logId);
});

function openLogEdit(logId) {
  const entry = currentLog.find((x) => x.id === logId);
  if (!entry) return;
  activeLogEntry = entry;
  const labels = { payment: "Payment", increase: "Added to balance" };
  document.getElementById("logEditTitle").textContent = labels[entry.type] || entry.type;
  document.getElementById("logEditAmount").value = entry.amount;
  document.getElementById("logEditDate").value = entry.date;
  document.getElementById("logEditHint").textContent = entry.type === "payment"
    ? "Editing or deleting this will also update the linked account balance and transaction."
    : "This only affects the debt balance — no account is linked to this entry.";
  document.getElementById("debtActionOverlay").classList.remove("open");
  document.getElementById("logEditOverlay").classList.add("open");
}

document.getElementById("logEditClose").addEventListener("click", () => {
  document.getElementById("logEditOverlay").classList.remove("open");
});

document.getElementById("logEditSave").addEventListener("click", async () => {
  const entry = activeLogEntry;
  if (!entry) return;
  const newAmount = parseFloat(document.getElementById("logEditAmount").value);
  const newDate = document.getElementById("logEditDate").value;
  if (!newAmount || newAmount <= 0 || !newDate) return;

  const d = debts.find((x) => x.id === entry.debt_id);
  const diff = newAmount - Number(entry.amount); // positive if amount increased

  if (entry.type === "increase") {
    await supabase.from("debts").update({ balance: Number(d.balance) + diff }).eq("id", d.id);
  } else if (entry.type === "payment") {
    // A bigger payment reduces the debt further; a smaller one owes more back.
    await supabase.from("debts").update({ balance: Math.max(0, Number(d.balance) - diff) }).eq("id", d.id);

    if (entry.account_id) {
      const { data: account } = await supabase.from("accounts").select("*").eq("id", entry.account_id).single();
      if (account) {
        const balanceDelta = d.direction === "owed_to_me" ? diff : -diff;
        await supabase.from("accounts").update({ balance: Number(account.balance) + balanceDelta }).eq("id", entry.account_id);
      }
    }
    if (entry.transaction_id) {
      await supabase.from("transactions").update({ amount: newAmount, date: newDate }).eq("id", entry.transaction_id);
    }
  }

  await supabase.from("debt_activity").update({ amount: newAmount, date: newDate }).eq("id", entry.id);

  document.getElementById("logEditOverlay").classList.remove("open");
  await loadAll();
  openActionSheet(entry.debt_id);
});

document.getElementById("logEditDelete").addEventListener("click", async () => {
  const entry = activeLogEntry;
  if (!entry) return;
  const ok = confirm("Delete this activity? The debt balance (and linked account, if any) will be adjusted back.");
  if (!ok) return;

  const d = debts.find((x) => x.id === entry.debt_id);

  if (entry.type === "increase") {
    await supabase.from("debts").update({ balance: Math.max(0, Number(d.balance) - Number(entry.amount)) }).eq("id", d.id);
  } else if (entry.type === "payment") {
    // Undo the payment's effect on the debt balance
    await supabase.from("debts").update({ balance: Number(d.balance) + Number(entry.amount) }).eq("id", d.id);

    if (entry.account_id) {
      const { data: account } = await supabase.from("accounts").select("*").eq("id", entry.account_id).single();
      if (account) {
        const revert = d.direction === "owed_to_me" ? -Number(entry.amount) : Number(entry.amount);
        await supabase.from("accounts").update({ balance: Number(account.balance) + revert }).eq("id", entry.account_id);
      }
    }
    if (entry.transaction_id) {
      await supabase.from("transactions").delete().eq("id", entry.transaction_id);
    }
  }

  await supabase.from("debt_activity").delete().eq("id", entry.id);

  document.getElementById("logEditOverlay").classList.remove("open");
  await loadAll();
  openActionSheet(entry.debt_id);
});

document.getElementById("debtActionClose").addEventListener("click", () => {
  document.getElementById("debtActionOverlay").classList.remove("open");
});

document.getElementById("deleteDebt").addEventListener("click", async () => {
  const ok = confirm("Delete this debt record? This won't affect any past transactions already logged.");
  if (!ok) return;
  await supabase.from("debts").delete().eq("id", activeDebtId);
  document.getElementById("debtActionOverlay").classList.remove("open");
  await loadAll();
});

// ---------- Increase debt (e.g. they borrowed/owe more, no cash moved yet) ----------
document.getElementById("openIncreaseDebt").addEventListener("click", () => {
  const d = debts.find((x) => x.id === activeDebtId);
  document.getElementById("debtActionOverlay").classList.remove("open");
  document.getElementById("increaseTitle").textContent = `Add to ${d.person}'s balance`;
  document.getElementById("increaseHint").textContent = d.direction === "owed_to_me"
    ? "This adds to how much they owe you. It won't touch your account balances — only a payment does that."
    : "This adds to how much you owe them. It won't touch your account balances — only a payment does that.";
  document.getElementById("increaseAmount").value = "";
  document.getElementById("increaseOverlay").classList.add("open");
});

document.getElementById("increaseClose").addEventListener("click", () => {
  document.getElementById("increaseOverlay").classList.remove("open");
});

document.getElementById("confirmIncrease").addEventListener("click", async () => {
  const amount = parseFloat(document.getElementById("increaseAmount").value);
  if (!amount || amount <= 0) return;
  const d = debts.find((x) => x.id === activeDebtId);

  const newBalance = Number(d.balance) + amount;
  await supabase.from("debts").update({ balance: newBalance }).eq("id", d.id);
  await supabase.from("debt_activity").insert({ debt_id: d.id, date: todayISO(), amount, type: "increase" });

  document.getElementById("increaseOverlay").classList.remove("open");
  await loadAll();
});

// ---------- Add debt ----------
document.getElementById("openAddDebt").addEventListener("click", () => {
  document.getElementById("addDebtOverlay").classList.add("open");
});
document.getElementById("addDebtClose").addEventListener("click", () => {
  document.getElementById("addDebtOverlay").classList.remove("open");
});

document.querySelectorAll("#addDebtOverlay .direction-toggle .pill").forEach((pill) => {
  pill.addEventListener("click", () => {
    document.querySelectorAll("#addDebtOverlay .direction-toggle .pill").forEach((p) => p.classList.remove("selected"));
    pill.classList.add("selected");
    addDirection = pill.dataset.direction;
  });
});

document.getElementById("confirmAddDebt").addEventListener("click", async () => {
  const person = document.getElementById("debtPerson").value.trim();
  const amount = parseFloat(document.getElementById("debtAmount").value);
  const note = document.getElementById("debtNote").value.trim() || null;
  if (!person || !amount || amount <= 0) return;

  const { data, error } = await supabase
    .from("debts")
    .insert({ person, direction: addDirection, balance: amount, note })
    .select()
    .single();

  if (!error && data) {
    await supabase.from("debt_activity").insert({ debt_id: data.id, date: todayISO(), amount, type: "created" });
  }

  document.getElementById("addDebtOverlay").classList.remove("open");
  document.getElementById("debtPerson").value = "";
  document.getElementById("debtAmount").value = "";
  document.getElementById("debtNote").value = "";
  await loadAll();
});

// ---------- Record payment ----------
document.getElementById("openRecordPayment").addEventListener("click", () => {
  const d = debts.find((x) => x.id === activeDebtId);
  document.getElementById("debtActionOverlay").classList.remove("open");

  document.getElementById("paymentTitle").textContent = `Payment ${d.direction === "owed_to_me" ? "from" : "to"} ${d.person}`;
  document.getElementById("paymentAccountLabel").textContent = d.direction === "owed_to_me" ? "Goes into" : "Paid from";

  const container = document.getElementById("paymentAccountPills");
  const defaultAcc = accounts.find((a) => a.name === "TNG Wallet") || accounts[0];
  paymentState.accountId = defaultAcc?.id || null;
  container.innerHTML = accounts
    .map((a) => `<button type="button" class="pill ${a.id === paymentState.accountId ? "selected" : ""}" data-account="${a.id}">${a.name}</button>`)
    .join("");
  container.querySelectorAll(".pill").forEach((pill) => {
    pill.addEventListener("click", () => {
      container.querySelectorAll(".pill").forEach((p) => p.classList.remove("selected"));
      pill.classList.add("selected");
      paymentState.accountId = pill.dataset.account;
    });
  });

  resetPaymentDatePills();
  document.getElementById("paymentAmount").value = "";
  document.getElementById("paymentOverlay").classList.add("open");
});

function resetPaymentDatePills() {
  const pillsContainer = document.getElementById("paymentDatePills");
  const wrap = document.getElementById("paymentDateWrap");
  const pills = pillsContainer.querySelectorAll(".pill");
  pills.forEach((p) => p.classList.remove("selected"));
  pills[0].classList.add("selected");
  wrap.classList.add("hidden");
  paymentState.date = todayISO();
}

let paymentDatePillsWired = false;
function wirePaymentDatePillsOnce() {
  if (paymentDatePillsWired) return;
  paymentDatePillsWired = true;
  const pillsContainer = document.getElementById("paymentDatePills");
  const wrap = document.getElementById("paymentDateWrap");
  const input = document.getElementById("paymentDate");
  const pills = pillsContainer.querySelectorAll(".pill");
  pills.forEach((pill) => {
    pill.addEventListener("click", () => {
      pills.forEach((p) => p.classList.remove("selected"));
      pill.classList.add("selected");
      if (pill.dataset.date === "today") { paymentState.date = todayISO(); wrap.classList.add("hidden"); }
      else if (pill.dataset.date === "yesterday") { paymentState.date = yesterdayISO(); wrap.classList.add("hidden"); }
      else { wrap.classList.remove("hidden"); input.value = paymentState.date; }
    });
  });
  input.addEventListener("change", () => { paymentState.date = input.value; });
}
wirePaymentDatePillsOnce();

document.getElementById("paymentClose").addEventListener("click", () => {
  document.getElementById("paymentOverlay").classList.remove("open");
});

document.getElementById("confirmPayment").addEventListener("click", async () => {
  const amount = parseFloat(document.getElementById("paymentAmount").value);
  if (!amount || amount <= 0) return;
  const d = debts.find((x) => x.id === activeDebtId);
  const accountId = paymentState.accountId;
  const account = accounts.find((a) => a.id === accountId);

  // 1. Adjust the debt balance
  const newBalance = Math.max(0, Number(d.balance) - amount);
  await supabase.from("debts").update({ balance: newBalance }).eq("id", d.id);

  // 2. Reflect the real cash movement as a normal transaction + account balance change
  let transactionId = null;
  if (d.direction === "owed_to_me") {
    const { data: tx } = await supabase.from("transactions").insert({
      date: paymentState.date, type: "income", amount, account_id: accountId,
      source: `Repayment from ${d.person}`,
    }).select().single();
    transactionId = tx?.id || null;
    await supabase.from("accounts").update({ balance: Number(account.balance) + amount }).eq("id", accountId);
  } else {
    const { data: tx } = await supabase.from("transactions").insert({
      date: paymentState.date, type: "expense", amount, account_id: accountId,
      note: `Repayment to ${d.person}`,
    }).select().single();
    transactionId = tx?.id || null;
    await supabase.from("accounts").update({ balance: Number(account.balance) - amount }).eq("id", accountId);
  }

  // 3. Log the activity, linked to the transaction/account so it can be edited or undone later
  await supabase.from("debt_activity").insert({
    debt_id: d.id, date: paymentState.date, amount, type: "payment",
    transaction_id: transactionId, account_id: accountId,
  });

  document.getElementById("paymentOverlay").classList.remove("open");
  await loadAll();
});

loadAll();

// ---------- Swipe down to dismiss any open sheet ----------
["addDebtOverlay", "debtActionOverlay", "increaseOverlay", "paymentOverlay", "logEditOverlay"].forEach((id) => {
  const overlay = document.getElementById(id);
  attachSwipeToDismiss(overlay, overlay.querySelector(".sheet-handle"), () => overlay.classList.remove("open"));
});

enableTabSwipe({ prev: "cards.html", next: "settings.html" });
