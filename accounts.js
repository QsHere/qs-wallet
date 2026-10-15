import { supabase, money, todayISO, yesterdayISO, attachSwipeToDismiss, accountIconHTML, fileToIconDataURL } from "./db.js";

const $ = (id) => document.getElementById(id);

let accounts = [];
let editingAccountId = null;
let transferState = { fromId: null, toId: null, date: todayISO() };
let currentTransfers = [];
let activeTransferEntry = null;

async function loadAll() {
  await loadAccounts();
  await loadTransferLog();
}

async function loadAccounts() {
  const { data, error } = await supabase.from("accounts").select("*").order("name");
  if (error) { console.error(error); return; }
  accounts = data || [];

  $("accountsList").innerHTML = accounts.length
    ? accounts.map((a) => `<li class="tappable" data-id="${a.id}">
        <span class="row-left">
          ${accountIconHTML(a)}
          <span class="row-title">${a.name}</span>
        </span>
        <span class="row-amt">${money(a.balance)}</span>
      </li>`).join("")
    : `<li class="empty-note">No accounts yet — add one below.</li>`;

  buildTransferPills();
}

// ---------- Add / edit account (with an optional picture) ----------
let formMode = "add";
let formIcon = null;        // data URL of the chosen picture, or null for the default emoji
let formIconDirty = false;  // true once the picture was changed or removed while editing

function renderFormPreview() {
  const name = $("accountFormName").value.trim() || "Account";
  $("accountFormPreview").innerHTML = accountIconHTML({ name, icon_url: formIcon });
  $("accountIconRemove").classList.toggle("hidden", !formIcon);
  $("accountIconPick").textContent = formIcon ? "📷 Change picture" : "📷 Upload picture";
}

function openAccountForm(mode, account) {
  formMode = mode;
  editingAccountId = account ? account.id : null;
  formIcon = account?.icon_url || null;
  formIconDirty = false;
  $("accountFormTitle").textContent = mode === "add" ? "New account" : "Edit account";
  $("accountFormName").value = account ? account.name : "";
  $("accountFormBalance").value = "";
  $("accountFormBalanceWrap").classList.toggle("hidden", mode !== "add");
  $("accountIconFile").value = "";
  $("saveAccountForm").disabled = false;
  renderFormPreview();
  $("accountFormOverlay").classList.add("open");
}

$("openAddAccount").addEventListener("click", () => openAccountForm("add"));

$("accountsList").addEventListener("click", (e) => {
  const row = e.target.closest("[data-id]");
  if (!row) return;
  const a = accounts.find((x) => x.id === row.dataset.id);
  if (a) openAccountForm("edit", a);
});

$("accountFormClose").addEventListener("click", () => $("accountFormOverlay").classList.remove("open"));
$("accountFormName").addEventListener("input", renderFormPreview);

$("accountIconPick").addEventListener("click", () => $("accountIconFile").click());

$("accountIconFile").addEventListener("change", async () => {
  const file = $("accountIconFile").files[0];
  if (!file) return;
  try {
    formIcon = await fileToIconDataURL(file);
    formIconDirty = true;
    renderFormPreview();
  } catch (err) {
    alert(err.message || "Couldn't use that picture.");
  }
  $("accountIconFile").value = "";
});

$("accountIconRemove").addEventListener("click", () => {
  formIcon = null;
  formIconDirty = true;
  renderFormPreview();
});

$("saveAccountForm").addEventListener("click", async () => {
  const saveBtn = $("saveAccountForm");
  if (saveBtn.disabled) return;
  const name = $("accountFormName").value.trim();
  if (!name) return;
  saveBtn.disabled = true;

  let error;
  if (formMode === "add") {
    const balance = parseFloat($("accountFormBalance").value) || 0;
    const row = { name, balance };
    if (formIcon) row.icon_url = formIcon; // only sent when there is a picture
    ({ error } = await supabase.from("accounts").insert(row));
  } else {
    const patch = { name };
    if (formIconDirty) patch.icon_url = formIcon; // null clears the picture
    ({ error } = await supabase.from("accounts").update(patch).eq("id", editingAccountId));
  }

  if (error) {
    console.error(error);
    alert(`Couldn't save this account: ${error.message}`);
    saveBtn.disabled = false;
    return;
  }

  $("accountFormOverlay").classList.remove("open");
  await loadAccounts();
});

// ---------- Transfer between accounts ----------
function buildTransferPills() {
  renderPillGroup("transferFromPills", transferState.fromId || accounts[0]?.id, (id) => { transferState.fromId = id; });
  renderPillGroup("transferToPills", transferState.toId || accounts[1]?.id || accounts[0]?.id, (id) => { transferState.toId = id; });
}

function renderPillGroup(containerId, selectedId, onSelect) {
  const container = $(containerId);
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

$("openTransfer").addEventListener("click", () => {
  $("transferAmount").value = "";
  $("transferNote").value = "";
  buildTransferPills();
  resetTransferDatePills();
  $("transferOverlay").classList.add("open");
});

$("transferClose").addEventListener("click", () => {
  $("transferOverlay").classList.remove("open");
});

function resetTransferDatePills() {
  const pills = document.querySelectorAll("#transferDatePills .pill");
  const wrap = $("transferDateWrap");
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
  const wrap = $("transferDateWrap");
  const input = $("transferDate");
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

$("confirmTransfer").addEventListener("click", async () => {
  const amount = parseFloat($("transferAmount").value);
  const note = $("transferNote").value.trim() || null;
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

  $("transferOverlay").classList.remove("open");
  await loadAll();
});

// ---------- Transfer history log ----------
async function loadTransferLog() {
  const logEl = $("transferLog");
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
      <span class="row-icon" style="background:#7B9BC433">⇄</span>
      <span>
        <div class="row-title">${accountName(t.from_account_id)} → ${accountName(t.to_account_id)}</div>
        <div class="row-meta">${t.date}${t.note ? " · " + t.note : ""}</div>
      </span>
    </span>
    <span class="row-amt">${money(t.amount)}</span>
  </li>`;
}

$("transferLog").addEventListener("click", (e) => {
  const row = e.target.closest("[data-id]");
  if (!row) return;
  openTransferEdit(row.dataset.id);
});

function openTransferEdit(id) {
  const t = currentTransfers.find((x) => x.id === id);
  if (!t) return;
  activeTransferEntry = t;
  $("transferEditTitle").textContent = `${accountName(t.from_account_id)} → ${accountName(t.to_account_id)}`;
  $("transferEditAmount").value = t.amount;
  $("transferEditDate").value = t.date;
  $("transferEditOverlay").classList.add("open");
}

$("transferEditClose").addEventListener("click", () => {
  $("transferEditOverlay").classList.remove("open");
});

$("transferEditSave").addEventListener("click", async () => {
  const t = activeTransferEntry;
  if (!t) return;
  const newAmount = parseFloat($("transferEditAmount").value);
  const newDate = $("transferEditDate").value;
  if (!newAmount || newAmount <= 0 || !newDate) return;

  const diff = newAmount - Number(t.amount);
  const { data: from } = await supabase.from("accounts").select("*").eq("id", t.from_account_id).single();
  const { data: to } = await supabase.from("accounts").select("*").eq("id", t.to_account_id).single();
  if (from) await supabase.from("accounts").update({ balance: Number(from.balance) - diff }).eq("id", t.from_account_id);
  if (to) await supabase.from("accounts").update({ balance: Number(to.balance) + diff }).eq("id", t.to_account_id);
  await supabase.from("transfers").update({ amount: newAmount, date: newDate }).eq("id", t.id);

  $("transferEditOverlay").classList.remove("open");
  await loadAll();
});

$("transferEditDelete").addEventListener("click", async () => {
  const t = activeTransferEntry;
  if (!t) return;
  const ok = confirm("Delete this transfer? Both account balances will be reversed.");
  if (!ok) return;

  const { data: from } = await supabase.from("accounts").select("*").eq("id", t.from_account_id).single();
  const { data: to } = await supabase.from("accounts").select("*").eq("id", t.to_account_id).single();
  if (from) await supabase.from("accounts").update({ balance: Number(from.balance) + Number(t.amount) }).eq("id", t.from_account_id);
  if (to) await supabase.from("accounts").update({ balance: Number(to.balance) - Number(t.amount) }).eq("id", t.to_account_id);
  await supabase.from("transfers").delete().eq("id", t.id);

  $("transferEditOverlay").classList.remove("open");
  await loadAll();
});

// ---------- Swipe down to dismiss any open sheet ----------
["accountFormOverlay", "transferOverlay", "transferEditOverlay"].forEach((id) => {
  const overlay = $(id);
  attachSwipeToDismiss(overlay, overlay.querySelector(".sheet-handle"), () => overlay.classList.remove("open"));
});

loadAll().then(() => {
  const params = new URLSearchParams(window.location.search);
  if (params.get("action") === "transfer") {
    $("openTransfer").click();
  }
});
