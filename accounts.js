import { supabase, money, todayISO, colorFor, attachSwipeToDismiss } from "./db.js";

let accounts = [];
let editingAccountId = null;
let transferState = { fromId: null, toId: null, date: todayISO() };
let currentTransfers = [];
let activeTransferEntry = null;

function yesterdayISO() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

async function loadAll() {
  await loadAccounts();
  await loadTransferLog();
}

async function loadAccounts() {
  const { data, error } = await supabase.from("accounts").select("*").order("name");
  if (error) { console.error(error); return; }
  accounts = data || [];

  document.getElementById("accountsList").innerHTML = accounts.length
    ? accounts.map((a) => `<li class="tappable" data-id="${a.id}">
        <span class="row-left">
          <span class="row-icon" style="background:${colorFor(a.name)}33">🏦</span>
          <span class="row-title">${a.name}</span>
        </span>
        <span class="row-amt">${money(a.balance)}</span>
      </li>`).join("")
    : `<li class="empty-note">No accounts yet — add one below.</li>`;

  buildTransferPills();
}

document.getElementById("accountsList").addEventListener("click", (e) => {
  const row = e.target.closest("[data-id]");
  if (!row) return;
  const a = accounts.find((x) => x.id === row.dataset.id);
  editingAccountId = a.id;
  document.getElementById("editAccountName").value = a.name;
  document.getElementById("editAccountOverlay").classList.add("open");
});

document.getElementById("editAccountClose").addEventListener("click", () => {
  document.getElementById("editAccountOverlay").classList.remove("open");
});

document.getElementById("saveAccountName").addEventListener("click", async () => {
  const name = document.getElementById("editAccountName").value.trim();
  if (!name) return;
  await supabase.from("accounts").update({ name }).eq("id", editingAccountId);
  document.getElementById("editAccountOverlay").classList.remove("open");
  await loadAccounts();
});

document.getElementById("addAccount").addEventListener("click", async () => {
  const name = document.getElementById("newAccountName").value.trim();
  const balance = parseFloat(document.getElementById("newAccountBalance").value) || 0;
  if (!name) return;
  await supabase.from("accounts").insert({ name, balance });
  document.getElementById("newAccountName").value = "";
  document.getElementById("newAccountBalance").value = "";
  await loadAccounts();
});

// ---------- Transfer between accounts ----------
function buildTransferPills() {
  renderPillGroup("transferFromPills", transferState.fromId || accounts[0]?.id, (id) => { transferState.fromId = id; });
  renderPillGroup("transferToPills", transferState.toId || accounts[1]?.id || accounts[0]?.id, (id) => { transferState.toId = id; });
}

function renderPillGroup(containerId, selectedId, onSelect) {
  const container = document.getElementById(containerId);
  container.innerHTML = accounts
    .map((a) => `<button type="button" class="pill ${a.id === selectedId ? "selected" : ""}" data-account="${a.id}">${a.name}</button>`)
    .join("");
  container.querySelectorAll(".pill").forEach((pill) => {
    pill.addEventListener("click", () => {
      container.querySelectorAll(".pill").forEach((p) => p.classList.remove("selected"));
      pill.classList.add("selected");
      onSelect(pill.dataset.account);
    });
  });
  onSelect(selectedId);
}

document.getElementById("openTransfer").addEventListener("click", () => {
  document.getElementById("transferAmount").value = "";
  document.getElementById("transferNote").value = "";
  buildTransferPills();
  resetTransferDatePills();
  document.getElementById("transferOverlay").classList.add("open");
});

document.getElementById("transferClose").addEventListener("click", () => {
  document.getElementById("transferOverlay").classList.remove("open");
});

function resetTransferDatePills() {
  const pills = document.querySelectorAll("#transferDatePills .pill");
  const wrap = document.getElementById("transferDateWrap");
  pills.forEach((p) => p.classList.remove("selected"));
  pills[0].classList.add("selected");
  wrap.classList.add("hidden");
  transferState.date = todayISO();
}

let transferDatePillsWired = false;
function wireTransferDatePillsOnce() {
  if (transferDatePillsWired) return;
  transferDatePillsWired = true;
  const pills = document.querySelectorAll("#transferDatePills .pill");
  const wrap = document.getElementById("transferDateWrap");
  const input = document.getElementById("transferDate");
  pills.forEach((pill) => {
    pill.addEventListener("click", () => {
      pills.forEach((p) => p.classList.remove("selected"));
      pill.classList.add("selected");
      if (pill.dataset.date === "today") { transferState.date = todayISO(); wrap.classList.add("hidden"); }
      else if (pill.dataset.date === "yesterday") { transferState.date = yesterdayISO(); wrap.classList.add("hidden"); }
      else { wrap.classList.remove("hidden"); input.value = transferState.date; }
    });
  });
  input.addEventListener("change", () => { transferState.date = input.value; });
}
wireTransferDatePillsOnce();

document.getElementById("confirmTransfer").addEventListener("click", async () => {
  const amount = parseFloat(document.getElementById("transferAmount").value);
  const note = document.getElementById("transferNote").value.trim() || null;
  const fromId = transferState.fromId;
  const toId = transferState.toId;
  if (!amount || amount <= 0) return;
  if (!fromId || !toId || fromId === toId) {
    alert("Pick two different accounts to transfer between.");
    return;
  }

  const from = accounts.find((a) => a.id === fromId);
  const to = accounts.find((a) => a.id === toId);

  await supabase.from("accounts").update({ balance: Number(from.balance) - amount }).eq("id", fromId);
  await supabase.from("accounts").update({ balance: Number(to.balance) + amount }).eq("id", toId);
  await supabase.from("transfers").insert({
    date: transferState.date, amount, from_account_id: fromId, to_account_id: toId, note,
  });

  document.getElementById("transferOverlay").classList.remove("open");
  await loadAll();
});

// ---------- Transfer history log ----------
async function loadTransferLog() {
  const logEl = document.getElementById("transferLog");
  const { data, error } = await supabase
    .from("transfers")
    .select("*")
    .order("date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(30);
  if (error) { console.error(error); return; }
  currentTransfers = data || [];

  logEl.innerHTML = currentTransfers.length
    ? currentTransfers.map(transferRowHTML).join("")
    : `<li class="empty-note">No transfers yet.</li>`;
}

function accountName(id) {
  return accounts.find((a) => a.id === id)?.name || "—";
}

function transferRowHTML(t) {
  return `<li class="tappable" data-id="${t.id}">
    <span class="row-left">
      <span class="row-icon" style="background:#0A84FF33">⇄</span>
      <span>
        <div class="row-title">${accountName(t.from_account_id)} → ${accountName(t.to_account_id)}</div>
        <div class="row-meta">${t.date}${t.note ? " · " + t.note : ""}</div>
      </span>
    </span>
    <span class="row-amt">${money(t.amount)}</span>
  </li>`;
}

document.getElementById("transferLog").addEventListener("click", (e) => {
  const row = e.target.closest("[data-id]");
  if (!row) return;
  openTransferEdit(row.dataset.id);
});

function openTransferEdit(id) {
  const t = currentTransfers.find((x) => x.id === id);
  if (!t) return;
  activeTransferEntry = t;
  document.getElementById("transferEditTitle").textContent = `${accountName(t.from_account_id)} → ${accountName(t.to_account_id)}`;
  document.getElementById("transferEditAmount").value = t.amount;
  document.getElementById("transferEditDate").value = t.date;
  document.getElementById("transferEditOverlay").classList.add("open");
}

document.getElementById("transferEditClose").addEventListener("click", () => {
  document.getElementById("transferEditOverlay").classList.remove("open");
});

document.getElementById("transferEditSave").addEventListener("click", async () => {
  const t = activeTransferEntry;
  if (!t) return;
  const newAmount = parseFloat(document.getElementById("transferEditAmount").value);
  const newDate = document.getElementById("transferEditDate").value;
  if (!newAmount || newAmount <= 0 || !newDate) return;

  const diff = newAmount - Number(t.amount);
  const { data: from } = await supabase.from("accounts").select("*").eq("id", t.from_account_id).single();
  const { data: to } = await supabase.from("accounts").select("*").eq("id", t.to_account_id).single();
  if (from) await supabase.from("accounts").update({ balance: Number(from.balance) - diff }).eq("id", t.from_account_id);
  if (to) await supabase.from("accounts").update({ balance: Number(to.balance) + diff }).eq("id", t.to_account_id);
  await supabase.from("transfers").update({ amount: newAmount, date: newDate }).eq("id", t.id);

  document.getElementById("transferEditOverlay").classList.remove("open");
  await loadAll();
});

document.getElementById("transferEditDelete").addEventListener("click", async () => {
  const t = activeTransferEntry;
  if (!t) return;
  const ok = confirm("Delete this transfer? Both account balances will be reversed.");
  if (!ok) return;

  const { data: from } = await supabase.from("accounts").select("*").eq("id", t.from_account_id).single();
  const { data: to } = await supabase.from("accounts").select("*").eq("id", t.to_account_id).single();
  if (from) await supabase.from("accounts").update({ balance: Number(from.balance) + Number(t.amount) }).eq("id", t.from_account_id);
  if (to) await supabase.from("accounts").update({ balance: Number(to.balance) - Number(t.amount) }).eq("id", t.to_account_id);
  await supabase.from("transfers").delete().eq("id", t.id);

  document.getElementById("transferEditOverlay").classList.remove("open");
  await loadAll();
});

// ---------- Swipe down to dismiss any open sheet ----------
["editAccountOverlay", "transferOverlay", "transferEditOverlay"].forEach((id) => {
  const overlay = document.getElementById(id);
  attachSwipeToDismiss(overlay, overlay.querySelector(".sheet-handle"), () => overlay.classList.remove("open"));
});

loadAll();
