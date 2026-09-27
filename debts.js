import { supabase, money, todayISO, colorFor, attachSwipeToDismiss, enableTabSwipe } from "./db.js";

let debts = [];
let accounts = [];
let activeDebtId = null;
let activeLogEntry = null;
let currentLog = [];
let addDirection = "owed_to_me";
let paymentState = { accountId: null, date: todayISO() };
let hideAmounts = localStorage.getItem("qs-hide-balance") === "1";

function maskedMoney(amount) {
  return hideAmounts ? "RM ••••" : money(amount);
}

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

function isCleared(d) {
  return Number(d.balance) <= 0.01;
}

function render() {
  const owed = debts.filter((d) => d.direction === "owed_to_me" && !isCleared(d));
  const owe = debts.filter((d) => d.direction === "i_owe" && !isCleared(d));
  const cleared = debts.filter(isCleared);

  document.getElementById("owedList").innerHTML = owed.length
    ? owed.map((d) => rowHTML(d, "owed")).join("")
    : `<li class="empty-note">Nobody owes you anything right now.</li>`;

  document.getElementById("oweList").innerHTML = owe.length
    ? owe.map((d) => rowHTML(d, "owe")).join("")
    : `<li class="empty-note">You don't owe anyone right now.</li>`;

  document.getElementById("clearedList").innerHTML = cleared.length
    ? cleared.map(clearedRowHTML).join("")
    : `<li class="empty-note">No cleared debts yet.</li>`;
  document.getElementById("clearedToggleLabel").textContent = `Cleared debts (${cleared.length})`;

  const totalOwed = owed.reduce((s, d) => s + Number(d.balance), 0);
  const totalOwe = owe.reduce((s, d) => s + Number(d.balance), 0);
  const net = totalOwed - totalOwe;
  const netEl = document.getElementById("netNumber");
  netEl.textContent = maskedMoney(Math.abs(net));
  netEl.classList.toggle("positive", net >= 0);
  netEl.classList.toggle("negative", net < 0);
  document.getElementById("netLabel").textContent = net >= 0 ? "Net: owed to you overall" : "Net: you owe overall";
}

function rowHTML(d, kind) {
  const today = new Date().toISOString().slice(0, 10);
  const isOverdue = d.deadline_date && d.deadline_date < today;
  const metaParts = [];
  if (d.note) metaParts.push(d.note);
  if (d.deadline_date) metaParts.push(`${isOverdue ? "⚠️ Overdue" : "Due"} ${d.deadline_date}`);
  return `<li class="tappable" data-id="${d.id}">
    <span class="row-left">
      <span class="row-icon" style="background:${colorFor(d.person)}33">${d.person.slice(0, 1).toUpperCase()}</span>
      <span>
        <div class="row-title">${d.person}</div>
        ${metaParts.length ? `<div class="row-meta">${metaParts.join(" · ")}</div>` : ""}
      </span>
    </span>
    <span class="row-amt ${kind}">${maskedMoney(d.balance)}</span>
  </li>`;
}

function clearedRowHTML(d) {
  const label = d.direction === "owed_to_me" ? "Was owed to you" : "You owed";
  return `<li class="tappable" data-id="${d.id}">
    <span class="row-left">
      <span class="row-icon" style="background:var(--bg-elevated-3)">${d.person.slice(0, 1).toUpperCase()}</span>
      <span>
        <div class="row-title">${d.person}</div>
        <div class="row-meta">${label}${d.note ? " · " + d.note : ""}</div>
      </span>
    </span>
    <span class="row-amt" style="color:var(--label-tertiary)">Cleared</span>
  </li>`;
}

// ---------- Hide/show amounts ----------
document.getElementById("toggleDebtVisibility").addEventListener("click", () => {
  hideAmounts = !hideAmounts;
  localStorage.setItem("qs-hide-balance", hideAmounts ? "1" : "0");
  render();
});

// ---------- Cleared debts collapse ----------
document.getElementById("toggleCleared").addEventListener("click", () => {
  document.getElementById("toggleCleared").classList.toggle("expanded");
  document.getElementById("clearedCollapse").classList.toggle("expanded");
});

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
wireListClicks("clearedList");

function openActionSheet(id) {
  activeDebtId = id;
  const d = debts.find((x) => x.id === id);
  document.getElementById("debtActionTitle").textContent = d.person;
  const label = d.direction === "owed_to_me" ? "owes you" : "you owe";
  let text = `${label} ${maskedMoney(d.balance)}`;
  if (d.deadline_date) {
    const today = new Date().toISOString().slice(0, 10);
    const overdue = d.deadline_date < today;
    text += ` · ${overdue ? "⚠️ Overdue since" : "Due"} ${d.deadline_date}`;
  }
  document.getElementById("debtActionBalance").textContent = text;
  document.getElementById("debtActionOverlay").classList.add("open");
  loadLog(id);
}

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

// ---------- Activity log ----------
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
  const labels = { payment: "Payment", increase: "Added to balance", created: "Debt created", netting: "Netted" };
  const label = labels[a.type] || a.type;
  const sign = (a.type === "payment" || a.type === "netting") ? "-" : "+";
  const tint = a.type === "payment" ? "#6FA98A33" : a.type === "netting" ? "#D9A86833" : "#7B9BC433";
  const icon = a.type === "payment" ? "💸" : a.type === "netting" ? "⚖️" : "➕";
  const editable = a.type !== "netting";
  const metaParts = [a.date];
  if (a.note) metaParts.push(a.note);
  if (!editable) metaParts.push("locked");
  return `<li class="${editable ? "tappable" : ""}" ${editable ? `data-log-id="${a.id}"` : ""}>
    <span class="row-left">
      <span class="row-icon" style="background:${tint}">${icon}</span>
      <span>
        <div class="row-title">${label}</div>
        <div class="row-meta">${metaParts.join(" · ")}</div>
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
  const labels = { payment: "Payment", increase: "Added to balance", created: "Debt created", netting: "Netted" };
  document.getElementById("logEditTitle").textContent = labels[entry.type] || entry.type;
  document.getElementById("logEditAmount").value = entry.amount;
  document.getElementById("logEditDate").value = entry.date;
  document.getElementById("logEditNote").value = entry.note || "";
  if (entry.type === "payment") {
    document.getElementById("logEditHint").textContent = "Editing or deleting this will also update the linked account balance and transaction, if one is linked.";
  } else if (entry.type === "created") {
    document.getElementById("logEditHint").textContent = "This was the starting amount for this debt. It can't be deleted while the debt exists, but you can correct the amount, date, or note.";
  } else {
    document.getElementById("logEditHint").textContent = "This only affects the debt balance — no account is linked to this entry.";
  }
  document.getElementById("logEditDelete").classList.toggle("hidden", entry.type === "created");
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
  const newNote = document.getElementById("logEditNote").value.trim() || null;
  if (!newAmount || newAmount <= 0 || !newDate) return;

  const d = debts.find((x) => x.id === entry.debt_id);
  const diff = newAmount - Number(entry.amount);

  if (entry.type === "increase" || entry.type === "created") {
    await supabase.from("debts").update({ balance: Number(d.balance) + diff }).eq("id", d.id);
  } else if (entry.type === "payment") {
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

  await supabase.from("debt_activity").update({ amount: newAmount, date: newDate, note: newNote }).eq("id", entry.id);
  document.getElementById("logEditOverlay").classList.remove("open");
  await loadAll();
  openActionSheet(entry.debt_id);
});

document.getElementById("logEditDelete").addEventListener("click", async () => {
  const entry = activeLogEntry;
  if (!entry) return;
  if (entry.type === "created") return; // guarded in UI too; belt and braces
  const ok = confirm("Delete this activity? The debt balance (and linked account, if any) will be adjusted back.");
  if (!ok) return;

  const d = debts.find((x) => x.id === entry.debt_id);

  if (entry.type === "increase") {
    await supabase.from("debts").update({ balance: Math.max(0, Number(d.balance) - Number(entry.amount)) }).eq("id", d.id);
  } else if (entry.type === "payment") {
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
});

// ---------- Add debt (with netting against an existing opposite-direction debt) ----------
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

function resetAddDebtForm() {
  document.getElementById("debtPerson").value = "";
  document.getElementById("debtAmount").value = "";
  document.getElementById("debtNote").value = "";
  document.getElementById("debtDeadline").value = "";
}

document.getElementById("confirmAddDebt").addEventListener("click", async () => {
  const person = document.getElementById("debtPerson").value.trim();
  const amount = parseFloat(document.getElementById("debtAmount").value);
  const note = document.getElementById("debtNote").value.trim() || null;
  const deadline_date = document.getElementById("debtDeadline").value || null;
  if (!person || !amount || amount <= 0) return;

  // Does this person already have a debt running the OTHER way? Offer to net them.
  const oppositeDirection = addDirection === "i_owe" ? "owed_to_me" : "i_owe";
  const existing = debts.find(
    (d) => d.direction === oppositeDirection && !isCleared(d) && d.person.trim().toLowerCase() === person.toLowerCase()
  );

  if (existing) {
    const existingSide = existing.direction === "owed_to_me" ? "owes you" : "you owe them";
    const proceed = confirm(
      `${person} already has a debt with you — ${existingSide} ${money(existing.balance)}.\n\nNet this new RM${amount.toFixed(2)} against it instead of creating a separate debt?`
    );
    if (proceed) {
      await nettDebts(existing, amount, addDirection, note, deadline_date);
      document.getElementById("addDebtOverlay").classList.remove("open");
      resetAddDebtForm();
      await loadAll();
      return;
    }
  }

  const { data, error } = await supabase
    .from("debts")
    .insert({ person, direction: addDirection, balance: amount, note, deadline_date })
    .select()
    .single();

  if (error) {
    console.error(error);
    alert(`Couldn't add this debt: ${error.message}`);
    return;
  }

  const { error: logError } = await supabase
    .from("debt_activity")
    .insert({ debt_id: data.id, date: todayISO(), amount, type: "created" });
  if (logError) console.error(logError);

  document.getElementById("addDebtOverlay").classList.remove("open");
  resetAddDebtForm();
  await loadAll();
});

// Nets a new debt against an existing opposite-direction debt for the same person.
// - If the new amount is bigger: the existing debt clears to 0, and a new debt is
//   created in the NEW direction for the remainder.
// - If the new amount is smaller: the existing debt survives in its ORIGINAL
//   direction, just reduced by the new amount. No new debt is created.
// - If they match exactly: the existing debt clears to 0, nothing new is created.
async function nettDebts(existing, newAmount, newDirection, note, deadline_date) {
  const existingBalance = Number(existing.balance);
  const net = Number((newAmount - existingBalance).toFixed(2));

  if (net > 0.004) {
    await supabase.from("debt_activity").insert({
      debt_id: existing.id, date: todayISO(), amount: existingBalance, type: "netting",
      note: `Cleared via netting against a new RM${newAmount.toFixed(2)} debt (direction flips)`,
    });
    await supabase.from("debts").update({ balance: 0 }).eq("id", existing.id);

    const { data: created, error } = await supabase.from("debts").insert({
      person: existing.person, direction: newDirection, balance: net, note, deadline_date,
    }).select().single();

    if (error) {
      console.error(error);
      alert(`Couldn't finish netting this debt: ${error.message}`);
      return;
    }

    await supabase.from("debt_activity").insert({
      debt_id: created.id, date: todayISO(), amount: net, type: "created",
      note: `Started at RM${newAmount.toFixed(2)}, netted against RM${existingBalance.toFixed(2)} already ${existing.direction === "owed_to_me" ? "owed to you" : "owed by you"}`,
    });
  } else if (net < -0.004) {
    const remaining = Number((existingBalance - newAmount).toFixed(2));
    await supabase.from("debt_activity").insert({
      debt_id: existing.id, date: todayISO(), amount: newAmount, type: "netting",
      note: `Offset by a new RM${newAmount.toFixed(2)} debt in the other direction (netting)`,
    });
    await supabase.from("debts").update({ balance: remaining }).eq("id", existing.id);
  } else {
    await supabase.from("debt_activity").insert({
      debt_id: existing.id, date: todayISO(), amount: existingBalance, type: "netting",
      note: `Fully cleared via netting against a matching RM${newAmount.toFixed(2)} debt`,
    });
    await supabase.from("debts").update({ balance: 0 }).eq("id", existing.id);
  }
}

// ---------- Increase debt (e.g. they borrowed/owe more, no cash moved yet) ----------
document.getElementById("openIncreaseDebt").addEventListener("click", () => {
  const d = debts.find((x) => x.id === activeDebtId);
  document.getElementById("debtActionOverlay").classList.remove("open");
  document.getElementById("increaseTitle").textContent = `Add to ${d.person}'s balance`;
  document.getElementById("increaseHint").textContent = d.direction === "owed_to_me"
    ? "This adds to how much they owe you. It won't touch your account balances — only a payment does that."
    : "This adds to how much you owe them. It won't touch your account balances — only a payment does that.";
  document.getElementById("increaseAmount").value = "";
  document.getElementById("increaseNote").value = "";
  document.getElementById("increaseOverlay").classList.add("open");
});

document.getElementById("increaseClose").addEventListener("click", () => {
  document.getElementById("increaseOverlay").classList.remove("open");
});

document.getElementById("confirmIncrease").addEventListener("click", async () => {
  const amount = parseFloat(document.getElementById("increaseAmount").value);
  if (!amount || amount <= 0) return;
  const note = document.getElementById("increaseNote").value.trim() || null;
  const d = debts.find((x) => x.id === activeDebtId);

  const newBalance = Number(d.balance) + amount;
  await supabase.from("debts").update({ balance: newBalance }).eq("id", d.id);
  await supabase.from("debt_activity").insert({ debt_id: d.id, date: todayISO(), amount, type: "increase", note });

  document.getElementById("increaseOverlay").classList.remove("open");
  document.getElementById("increaseNote").value = "";
  await loadAll();
});

// ---------- Record payment ----------
document.getElementById("openRecordPayment").addEventListener("click", () => {
  const d = debts.find((x) => x.id === activeDebtId);
  document.getElementById("debtActionOverlay").classList.remove("open");

  document.getElementById("paymentTitle").textContent = `Payment ${d.direction === "owed_to_me" ? "from" : "to"} ${d.person}`;
  document.getElementById("paymentAccountLabel").textContent = d.direction === "owed_to_me" ? "Goes into" : "Paid from";
  document.getElementById("paymentNote").value = "";

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
  const note = document.getElementById("paymentNote").value.trim() || null;
  const d = debts.find((x) => x.id === activeDebtId);
  const accountId = paymentState.accountId;
  const account = accounts.find((a) => a.id === accountId);

  const newBalance = Math.max(0, Number(d.balance) - amount);
  await supabase.from("debts").update({ balance: newBalance }).eq("id", d.id);

  let transactionId = null;
  if (d.direction === "owed_to_me") {
    const { data: tx } = await supabase.from("transactions").insert({
      date: paymentState.date, type: "income", amount, account_id: accountId,
      source: note ? `Repayment from ${d.person}: ${note}` : `Repayment from ${d.person}`,
    }).select().single();
    transactionId = tx?.id || null;
    await supabase.from("accounts").update({ balance: Number(account.balance) + amount }).eq("id", accountId);
  } else {
    const { data: tx } = await supabase.from("transactions").insert({
      date: paymentState.date, type: "expense", amount, account_id: accountId,
      note: note ? `Repayment to ${d.person}: ${note}` : `Repayment to ${d.person}`,
    }).select().single();
    transactionId = tx?.id || null;
    await supabase.from("accounts").update({ balance: Number(account.balance) - amount }).eq("id", accountId);
  }

  await supabase.from("debt_activity").insert({
    debt_id: d.id, date: paymentState.date, amount, type: "payment",
    transaction_id: transactionId, account_id: accountId, note,
  });

  document.getElementById("paymentOverlay").classList.remove("open");
  document.getElementById("paymentNote").value = "";
  await loadAll();
});

// ---------- Swipe down to dismiss any open sheet ----------
["addDebtOverlay", "debtActionOverlay", "logEditOverlay", "increaseOverlay", "paymentOverlay"].forEach((id) => {
  const overlay = document.getElementById(id);
  attachSwipeToDismiss(overlay, overlay.querySelector(".sheet-handle"), () => overlay.classList.remove("open"));
});

enableTabSwipe({ prev: "cards.html", next: "settings.html" });

loadAll();
