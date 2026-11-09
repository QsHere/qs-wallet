import { supabase, colorFor, attachSwipeToDismiss } from "./db.js";
import { rememberNote } from "./notes.js";

// Edit mode for the transaction detail sheet, shared by Home and Search so both behave identically.
// The page owns the "view" half of the sheet (filling in the read-only rows) and tells this module
// how to reach its data:
//   getTx()         -> the raw transaction currently open (or null)
//   getCategories() -> all categories
//   getAccounts()   -> all accounts ({ id, name })
//   onChanged()     -> called after a save/delete so the page can refresh itself

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
const round2 = (n) => Math.round(n * 100) / 100;
// Income adds to an account, an expense takes away
const effect = (type, amount) => (type === "income" ? Number(amount) : -Number(amount));

const EDIT_BLOCKS = [
  "detailEditRow", "detailEditTypeWrap", "detailTypeLockedHint", "detailEditAccountWrap",
  "detailEditCategoryWrap", "detailEditSourceWrap", "detailEditDateWrap", "detailEditNoteWrap",
];

export function initTxEditor({ getTx, getCategories, getAccounts, onChanged }) {
  // status: "checking" (looking for linked debt/card records), "locked" (linked), "open" (fully editable)
  let state = { type: "expense", categoryId: null, accountId: null, status: "checking" };

  function pathLabel(cat) {
    const all = getCategories();
    const parts = [cat.name];
    let cur = cat;
    let guard = 0;
    while (cur && cur.parent_id && guard++ < 8) {
      cur = all.find((x) => x.id === cur.parent_id);
      if (cur) parts.unshift(cur.name);
    }
    return parts.join(" › ");
  }

  // Back to the read-only look; pages call this whenever they open the sheet
  function reset() {
    [...EDIT_BLOCKS, "detailSaveEdit", "detailDelete", "detailManageCardLink"].forEach((id) => $(id).classList.add("hidden"));
    $("detailEditToggle").classList.remove("hidden");
    $("detailDelete").disabled = false;
    $("detailSaveEdit").disabled = false;
    $("categoryPickerOverlay").classList.remove("open");
  }

  function render() {
    const s = state;
    const open = s.status === "open";
    $("detailEditTypeWrap").classList.toggle("hidden", !open);
    $("detailTypeLockedHint").classList.toggle("hidden", s.status !== "locked");
    $("detailTypeExpense").classList.toggle("selected", s.type === "expense");
    $("detailTypeIncome").classList.toggle("selected", s.type === "income");
    $("detailEditAccountWrap").classList.toggle("hidden", !open);
    $("detailEditCategoryWrap").classList.toggle("hidden", !open || s.type !== "expense");
    $("detailEditSourceWrap").classList.toggle("hidden", !open || s.type !== "income");

    $("detailEditAccountLabel").textContent = s.type === "income" ? "Received in" : "Paid from";
    $("detailEditAccountPills").innerHTML = getAccounts()
      .map((a) => `<button type="button" class="pill ${a.id === s.accountId ? "selected" : ""}" data-account-id="${esc(a.id)}">${esc(a.name)}</button>`)
      .join("");

    const cat = s.categoryId ? getCategories().find((c) => c.id === s.categoryId) : null;
    const text = $("detailEditCategoryText");
    text.textContent = cat ? `${cat.icon || "🏷️"} ${pathLabel(cat)}` : "Choose…";
    text.classList.toggle("empty", !cat);
  }

  // Debt repayments, debt-created entries and card top-ups are tied to other records
  // (their own balances and logs), so changing their type, category or account here
  // would leave those records out of sync.
  async function isLinkedTransaction(id) {
    const [d, c] = await Promise.all([
      supabase.from("debt_activity").select("id").eq("transaction_id", id).limit(1),
      supabase.from("card_activity").select("id").eq("transaction_id", id).limit(1),
    ]);
    if (d.error || c.error) return true; // can't verify — stay on the safe side
    return (d.data || []).length > 0 || (c.data || []).length > 0;
  }

  // ----- enter edit mode -----
  $("detailEditToggle").addEventListener("click", async () => {
    const t = getTx();
    if (!t) return;

    ["detailEditRow", "detailEditDateWrap", "detailEditNoteWrap", "detailSaveEdit", "detailDelete"]
      .forEach((id) => $(id).classList.remove("hidden"));
    $("detailEditToggle").classList.add("hidden");

    state = {
      type: t.type,
      categoryId: t.type === "expense" ? t.category_id : null,
      accountId: t.account_id || null,
      status: "checking",
    };
    $("detailEditSource").value = t.source || "";
    render();

    const linked = await isLinkedTransaction(t.id);
    if (getTx() !== t) return; // sheet was closed or changed meanwhile
    state.status = linked ? "locked" : "open";
    render();
  });

  // ----- type / account -----
  $("detailEditTypeWrap").addEventListener("click", (e) => {
    const pill = e.target.closest("[data-edit-type]");
    if (!pill || state.status !== "open") return;
    state.type = pill.dataset.editType;
    render();
  });

  $("detailEditAccountPills").addEventListener("click", (e) => {
    const pill = e.target.closest("[data-account-id]");
    if (!pill || state.status !== "open") return;
    state.accountId = pill.dataset.accountId;
    render();
  });

  // ----- category picker (its own sheet, so the edit form stays short) -----
  const picker = $("categoryPickerOverlay");
  const closePicker = () => picker.classList.remove("open");

  $("detailEditCategoryBtn").addEventListener("click", () => {
    if (state.status !== "open") return;
    const items = getCategories()
      .filter((c) => !c.is_system)
      .map((c) => ({ c, label: pathLabel(c) }))
      .sort((a, b) => a.label.localeCompare(b.label));
    $("categoryPickerList").innerHTML = items.length
      ? items.map(({ c, label }) => `<li class="tappable" data-cat-id="${esc(c.id)}">
          <span class="row-left">
            <span class="row-icon" style="background:${colorFor(c.name)}33">${esc(c.icon || "🏷️")}</span>
            <span class="row-title">${esc(label)}</span>
          </span>
          ${c.id === state.categoryId ? '<span class="check">✓</span>' : ""}
        </li>`).join("")
      : `<li class="empty-note">No categories yet.</li>`;
    picker.classList.add("open");
  });

  $("categoryPickerList").addEventListener("click", (e) => {
    const row = e.target.closest("[data-cat-id]");
    if (!row) return;
    state.categoryId = row.dataset.catId;
    closePicker();
    render();
  });
  $("categoryPickerClose").addEventListener("click", closePicker);
  attachSwipeToDismiss(picker, picker.querySelector(".sheet-handle"), closePicker);

  // ----- save -----
  $("detailSaveEdit").addEventListener("click", async () => {
    const saveBtn = $("detailSaveEdit");
    if (saveBtn.disabled) return;
    const t = getTx();
    if (!t) return;

    const newAmount = parseFloat($("detailEditAmount").value);
    const newDate = $("detailEditDate").value;
    const newNote = $("detailEditNote").value.trim() || null;
    if (!newAmount || newAmount <= 0 || !newDate) return;

    const s = state;
    const editable = s.status === "open"; // type / account / category / source only change when unlocked
    const newType = editable ? s.type : t.type;
    const newAccountId = editable ? (s.accountId || t.account_id || null) : (t.account_id || null);

    if (editable && newType === "expense" && t.type === "income" && !s.categoryId) {
      alert("Pick a category for this expense.");
      return;
    }

    saveBtn.disabled = true;

    const payload = { amount: newAmount, date: newDate, note: newNote };
    if (editable) {
      payload.type = newType;
      if (newAccountId !== (t.account_id || null)) payload.account_id = newAccountId;
      if (newType === "expense") {
        payload.category_id = s.categoryId;
        if (t.type === "income") payload.source = null;
      } else {
        payload.source = $("detailEditSource").value.trim() || null;
        if (t.type === "expense") payload.category_id = null;
      }
    }

    const { error } = await supabase.from("transactions").update(payload).eq("id", t.id);
    if (error) {
      console.error(error);
      alert(`Couldn't save changes: ${error.message}`);
      saveBtn.disabled = false;
      return;
    }

    if (newNote) rememberNote(newNote, "note");
    if (payload.source) rememberNote(payload.source, "source");

    // Balances. Same account: apply only the difference. Moved to another account:
    // take the old effect off the old account and put the new effect on the new one.
    const oldAccountId = t.account_id || null;
    const deltas = new Map();
    if (newAccountId === oldAccountId) {
      if (oldAccountId) deltas.set(oldAccountId, effect(newType, newAmount) - effect(t.type, t.amount));
    } else {
      if (oldAccountId) deltas.set(oldAccountId, -effect(t.type, t.amount));
      if (newAccountId) deltas.set(newAccountId, effect(newType, newAmount));
    }
    for (const [accountId, delta] of deltas) {
      if (Math.abs(delta) < 0.0001) continue;
      const { data: account } = await supabase.from("accounts").select("*").eq("id", accountId).single();
      if (account) {
        await supabase.from("accounts").update({ balance: round2(Number(account.balance) + delta) }).eq("id", accountId);
      }
    }

    $("detailOverlay").classList.remove("open");
    await onChanged();
  });

  // ----- delete -----
  $("detailDelete").addEventListener("click", async () => {
    const deleteBtn = $("detailDelete");
    if (deleteBtn.disabled) return; // already processing — ignore a second tap
    if (!confirm("Delete this transaction? This will also reverse its effect on the account balance.")) return;
    deleteBtn.disabled = true; // lock at once so a fast second tap can't double-reverse the balance

    const t = getTx();
    if (!t) { deleteBtn.disabled = false; return; }

    if (t.account_id) {
      const { data: account } = await supabase.from("accounts").select("*").eq("id", t.account_id).single();
      if (account) {
        const revert = t.type === "expense" ? Number(t.amount) : -Number(t.amount);
        await supabase.from("accounts").update({ balance: round2(Number(account.balance) + revert) }).eq("id", t.account_id);
      }
    }
    await supabase.from("transactions").delete().eq("id", t.id);

    $("detailOverlay").classList.remove("open");
    await onChanged();
  });

  return { reset };
}
