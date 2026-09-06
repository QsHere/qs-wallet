import { supabase, money, todayISO, colorFor } from "./db.js";

let debts = [];
let accounts = [];
let activeDebtId = null;
let addDirection = "owed_to_me";
let paymentState = { accountId: null, date: todayISO() };

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
  netEl.textContent = money(Math.abs(net));
  netEl.classList.toggle("positive", net >= 0);
  netEl.classList.toggle("negative", net < 0);
  document.getElementById("netLabel").textContent = net >= 0 ? "Net: owed to you overall" : "Net: you owe overall";
}

function rowHTML(d, kind) {
  return `<li class="tappable" data-id="${d.id}">
    <span class="row-left">
      <span class="row-icon" style="background:${colorFor(d.person)}33">${d.person.slice(0, 1).toUpperCase()}</span>
      <span>
        <div class="row-title">${d.person}</div>
        ${d.note ? `<div class="row-meta">${d.note}</div>` : ""}
      </span>
    </span>
    <span class="row-amt ${kind}">${money(d.balance)}</span>
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
  document.getElementById("debtActionBalance").textContent = `${label} ${money(d.balance)}`;
  document.getElementById("debtActionOverlay").classList.add("open");
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

  await supabase.from("debts").insert({ person, direction: addDirection, balance: amount, note });

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
  await supabase.from("debt_activity").insert({ debt_id: d.id, date: paymentState.date, amount, type: "payment" });

  // 2. Reflect the real cash movement as a normal transaction + account balance change
  if (d.direction === "owed_to_me") {
    await supabase.from("transactions").insert({
      date: paymentState.date, type: "income", amount, account_id: accountId,
      source: `Repayment from ${d.person}`,
    });
    await supabase.from("accounts").update({ balance: Number(account.balance) + amount }).eq("id", accountId);
  } else {
    await supabase.from("transactions").insert({
      date: paymentState.date, type: "expense", amount, account_id: accountId,
      note: `Repayment to ${d.person}`,
    });
    await supabase.from("accounts").update({ balance: Number(account.balance) - amount }).eq("id", accountId);
  }

  document.getElementById("paymentOverlay").classList.remove("open");
  await loadAll();
});

loadAll();
