import { supabase, money, colorFor, attachSwipeToDismiss } from "./db.js";
import { attachNoteSuggest } from "./notes.js";

const $ = (id) => document.getElementById(id);
const PAGE = 100;
const RECENT_KEY = "qs-recent-searches";
const SORTS = [
  ["newest", "Newest first"],
  ["oldest", "Oldest first"],
  ["highest", "Highest amount"],
];

// ---------- small helpers ----------
const norm = (s) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
const reEscape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const isNum = (w) => /^\d+(\.\d+)?$/.test(w);

// Local-time YYYY-MM-DD (toISOString would shift the date by the UTC offset)
function localISO(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function fmtDate(iso) {
  return new Date(iso + "T00:00:00").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
}
function fmtShort(iso) {
  return new Date(iso + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function highlight(text, words) {
  if (!text) return "";
  const terms = [...new Set(words)].filter(Boolean).sort((a, b) => b.length - a.length).map(reEscape);
  if (!terms.length) return esc(text);
  const re = new RegExp(`(${terms.join("|")})`, "gi");
  return String(text).split(re).map((part, i) => (i % 2 === 1 ? `<mark>${esc(part)}</mark>` : esc(part))).join("");
}

// ---------- data ----------
let categories = [];
let catById = new Map();
let allItems = [];
let itemByKey = new Map();
let loaded = false;

const state = { query: "", type: "all", range: "all", start: "", end: "", sort: "newest", limit: PAGE };

async function fetchAll(table, select, build) {
  const pageSize = 1000;
  const rows = [];
  for (let from = 0; ; from += pageSize) {
    let q = supabase.from(table).select(select)
      .order("date", { ascending: false })
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(from, from + pageSize - 1);
    if (build) q = build(q);
    const { data, error } = await q;
    if (error) throw error;
    rows.push(...data);
    if (data.length < pageSize) break;
  }
  return rows;
}

function pathLabel(c) {
  const parts = [c.name];
  let cur = c;
  let guard = 0;
  while (cur && cur.parent_id && guard++ < 8) {
    cur = catById.get(cur.parent_id);
    if (cur) parts.unshift(cur.name);
  }
  return parts.join(" › ");
}

function buildTxItem(t) {
  const isIncome = t.type === "income";
  const catName = t.categories?.name || "";
  const isTopUp = !isIncome && catName === "Card Top-up";
  const cat = t.category_id ? catById.get(t.category_id) : null;
  const title = isIncome ? (t.source || "Income") : (isTopUp ? (t.note || "Card top up") : (catName || "Expense"));
  const icon = isIncome ? "💰" : (isTopUp ? "💳" : (t.categories?.icon || "🏷️"));
  return {
    kind: "tx",
    id: t.id,
    date: t.date,
    created_at: t.created_at || "",
    type: isIncome ? "income" : "expense",
    amount: Number(t.amount),
    title,
    subtitle: isTopUp ? "" : (t.note || ""),
    icon,
    tint: isIncome ? "#6FA98A33" : (isTopUp ? "#7B9BC433" : colorFor(title) + "33"),
    raw: t,
    haystack: norm([t.note, t.source, cat ? pathLabel(cat) : catName, isTopUp ? "card top up" : ""].filter(Boolean).join(" · ")),
  };
}

function buildCardItem(c) {
  const cardName = c.cards?.name || "Card";
  return {
    kind: "card",
    id: c.id,
    date: c.date,
    created_at: c.created_at || "",
    type: "card",
    amount: Number(c.amount),
    title: c.detail || `${cardName} spend`,
    subtitle: c.detail ? cardName : "",
    icon: "💳",
    tint: "#D0827233",
    raw: c,
    haystack: norm([c.detail, cardName, "card"].filter(Boolean).join(" · ")),
  };
}

async function loadData() {
  $("loadingNote").classList.remove("hidden");
  try {
    const [txRows, cardRows, catRes] = await Promise.all([
      fetchAll("transactions", "id, date, time_period, type, amount, source, note, account_id, category_id, created_at, accounts(name), categories(name, icon)"),
      fetchAll("card_activity", "id, date, amount, type, detail, created_at, cards(name)", (q) => q.eq("type", "spend")).catch(() => []),
      supabase.from("categories").select("*"),
    ]);
    categories = catRes.data || [];
    catById = new Map(categories.map((c) => [c.id, c]));
    allItems = [...txRows.map(buildTxItem), ...cardRows.map(buildCardItem)];
    itemByKey = new Map(allItems.map((i) => [`${i.kind}:${i.id}`, i]));
    loaded = true;
  } catch (err) {
    console.error(err);
    alert(`Couldn't load your history: ${err.message || err}`);
  }
  $("loadingNote").classList.add("hidden");
}

// ---------- searching ----------
const cmpNewest = (a, b) => b.date.localeCompare(a.date) || b.created_at.localeCompare(a.created_at);

function currentRange() {
  if (state.range === "month") {
    const now = new Date();
    return { start: localISO(new Date(now.getFullYear(), now.getMonth(), 1)), end: localISO(new Date(now.getFullYear(), now.getMonth() + 1, 0)) };
  }
  if (state.range === "custom") return { start: state.start, end: state.end };
  return { start: "", end: "" };
}

function getResults(words) {
  const { start, end } = currentRange();
  const out = allItems.filter((it) => {
    if (state.type === "expense" && it.type !== "expense") return false;
    if (state.type === "income" && it.type !== "income") return false;
    if (state.type === "card" && it.kind !== "card") return false;
    if (start && it.date < start) return false;
    if (end && it.date > end) return false;
    // every word must match somewhere (text), or equal the amount if it's a number
    return words.every((w) => it.haystack.includes(w) || (isNum(w) && Math.abs(Number(w) - it.amount) < 0.005));
  });
  if (state.sort === "highest") out.sort((a, b) => b.amount - a.amount || cmpNewest(a, b));
  else if (state.sort === "oldest") out.sort((a, b) => cmpNewest(b, a));
  else out.sort(cmpNewest);
  return out;
}

function isIdle() {
  return !state.query.trim() && state.type === "all" && state.range === "all";
}

// ---------- rendering ----------
function rowHTML(it, words, showDate) {
  const sign = it.type === "income" ? "+" : "-";
  const amtCls = it.type === "income" ? "income" : "expense";
  const meta = [];
  if (showDate) meta.push(esc(fmtShort(it.date)));
  if (it.subtitle) meta.push(highlight(it.subtitle, words));
  return `<li class="tappable" data-key="${it.kind}:${esc(it.id)}">
    <span class="row-left">
      <span class="row-icon" style="background:${it.tint}">${esc(it.icon)}</span>
      <span>
        <div class="row-title">${highlight(it.title, words)}</div>
        ${meta.length ? `<div class="row-meta">${meta.join(" · ")}</div>` : ""}
      </span>
    </span>
    <span class="row-amt ${amtCls}">${sign}${money(it.amount)}</span>
  </li>`;
}

function render() {
  if (!loaded) return;
  const idle = isIdle();
  $("idleState").classList.toggle("hidden", !idle);
  $("resultsArea").classList.toggle("hidden", idle);
  if (idle) { renderIdle(); return; }

  const words = norm(state.query).split(/\s+/).filter(Boolean);
  const results = getResults(words);

  const sum = (type) => results.filter((r) => r.type === type).reduce((s, r) => s + r.amount, 0);
  const spent = sum("expense");
  const income = sum("income");
  const card = sum("card");
  $("searchSummary").innerHTML =
    `<span><b>${results.length}</b> result${results.length === 1 ? "" : "s"}</span>` +
    (spent > 0 ? `<span>Spent <b>${money(spent)}</b></span>` : "") +
    (income > 0 ? `<span>Received <b>${money(income)}</b></span>` : "") +
    (card > 0 ? `<span>Card <b>${money(card)}</b></span>` : "");

  const shown = results.slice(0, state.limit);
  let html = "";
  if (!results.length) {
    html = `<p class="empty-note">No matches. Try fewer words, or loosen the filters.</p>`;
  } else if (state.sort === "highest") {
    html = `<ul class="grouped-list">${shown.map((it) => rowHTML(it, words, true)).join("")}</ul>`;
  } else {
    let currentDate = null;
    let rows = [];
    const flush = () => {
      if (currentDate !== null) {
        html += `<div class="history-group"><div class="history-date">${esc(fmtDate(currentDate))}</div><ul class="grouped-list">${rows.join("")}</ul></div>`;
      }
      rows = [];
    };
    for (const it of shown) {
      if (it.date !== currentDate) { flush(); currentDate = it.date; }
      rows.push(rowHTML(it, words, false));
    }
    flush();
  }
  $("resultsList").innerHTML = html;

  const remaining = results.length - shown.length;
  const moreBtn = $("showMore");
  moreBtn.classList.toggle("hidden", remaining <= 0);
  if (remaining > 0) moreBtn.textContent = `Show ${Math.min(PAGE, remaining)} more (${remaining} left)`;
}

// ---------- recent searches ----------
function getRecents() {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY)) || []; } catch { return []; }
}
function saveRecent(q) {
  const term = q.trim();
  if (term.length < 2) return;
  const list = [term, ...getRecents().filter((x) => x.toLowerCase() !== term.toLowerCase())].slice(0, 8);
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(list)); } catch { /* storage unavailable */ }
}

function renderIdle() {
  const recents = getRecents();
  $("recentSearchesWrap").classList.toggle("hidden", !recents.length);
  $("recentSearches").innerHTML = recents.map((q, i) => `<button type="button" class="pill" data-recent="${i}">${esc(q)}</button>`).join("");
  $("idleTip").textContent =
    `Searching across ${allItems.length} entr${allItems.length === 1 ? "y" : "ies"}. ` +
    `Type several words to narrow down (e.g. "lunch ali"), or an exact amount like 12.50. ` +
    `You can also use the filters to browse without typing.`;
}

// ---------- controls ----------
const input = $("searchInput");
let debounce;

function setQuery(value) {
  state.query = value;
  state.limit = PAGE;
  $("searchBar").classList.toggle("has-text", value.length > 0);
  render();
}

input.addEventListener("input", () => {
  clearTimeout(debounce);
  debounce = setTimeout(() => setQuery(input.value), 80);
});
input.addEventListener("keydown", (e) => {
  if (e.key === "Enter") { saveRecent(input.value); input.blur(); }
});
$("clearSearch").addEventListener("click", () => { input.value = ""; setQuery(""); input.focus(); });

$("recentSearches").addEventListener("click", (e) => {
  const pill = e.target.closest("[data-recent]");
  if (!pill) return;
  const q = getRecents()[Number(pill.dataset.recent)];
  if (q) { input.value = q; setQuery(q); }
});
$("clearRecents").addEventListener("click", () => {
  try { localStorage.removeItem(RECENT_KEY); } catch { /* ignore */ }
  render();
});

$("typeFilters").addEventListener("click", (e) => {
  const pill = e.target.closest("[data-type]");
  if (!pill) return;
  document.querySelectorAll("#typeFilters .pill").forEach((p) => p.classList.toggle("selected", p === pill));
  state.type = pill.dataset.type;
  state.limit = PAGE;
  render();
});

$("dateFilters").addEventListener("click", (e) => {
  const pill = e.target.closest("[data-range]");
  if (!pill) return;
  document.querySelectorAll("#dateFilters [data-range]").forEach((p) => p.classList.toggle("selected", p === pill));
  state.range = pill.dataset.range;
  $("customRangeWrap").classList.toggle("hidden", state.range !== "custom");
  state.limit = PAGE;
  render();
});
$("rangeStart").addEventListener("change", () => { state.start = $("rangeStart").value; state.limit = PAGE; render(); });
$("rangeEnd").addEventListener("change", () => { state.end = $("rangeEnd").value; state.limit = PAGE; render(); });

$("sortBtn").addEventListener("click", () => {
  const idx = SORTS.findIndex(([key]) => key === state.sort);
  const next = SORTS[(idx + 1) % SORTS.length];
  state.sort = next[0];
  $("sortBtn").textContent = next[1];
  state.limit = PAGE;
  render();
});

$("showMore").addEventListener("click", () => { state.limit += PAGE; render(); });

$("backLink").addEventListener("click", (e) => {
  try {
    if (document.referrer && new URL(document.referrer).origin === location.origin && history.length > 1) {
      e.preventDefault();
      history.back();
    }
  } catch { /* fall back to the plain link */ }
});

// ---------- detail sheet ----------
let activeItem = null;
let editState = { type: "expense", categoryId: null, locked: true };

$("resultsList").addEventListener("click", (e) => {
  const row = e.target.closest("[data-key]");
  if (!row) return;
  const item = itemByKey.get(row.dataset.key);
  if (!item) return;
  saveRecent(state.query);
  if (item.kind === "card") openCardDetail(item); else openTxDetail(item);
});

function hideEditExtras() {
  ["detailEditTypeWrap", "detailTypeLockedHint", "detailEditCategoryWrap", "detailEditSourceWrap"]
    .forEach((id) => $(id).classList.add("hidden"));
}

function resetSheetControls() {
  ["detailEditRow", "detailEditDateWrap", "detailEditNoteWrap", "detailSaveEdit", "detailDelete", "detailManageCardLink"]
    .forEach((id) => $(id).classList.add("hidden"));
  $("detailEditToggle").classList.remove("hidden");
  $("detailDelete").disabled = false;
  $("detailSaveEdit").disabled = false;
  hideEditExtras();
}

function openTxDetail(item) {
  const t = item.raw;
  activeItem = item;
  resetSheetControls();

  const isIncome = t.type === "income";
  $("detailIcon").textContent = item.icon;
  $("detailIconWrap").style.background = item.tint;
  const amtEl = $("detailAmount");
  amtEl.textContent = `${isIncome ? "+" : "-"}${money(t.amount)}`;
  amtEl.className = `detail-amount ${t.type}`;

  $("detailCategoryLabel").textContent = "Category";
  $("detailCategory").textContent = item.title;
  $("detailAccountLabel").textContent = "Account";
  $("detailAccount").textContent = t.accounts?.name || "—";
  $("detailDate").textContent = fmtDate(t.date);
  $("detailPeriod").textContent = t.time_period || "—";

  const noteRow = $("detailNoteRow");
  noteRow.classList.toggle("hidden", !t.note);
  if (t.note) $("detailNote").textContent = t.note;

  $("detailEditAmount").value = t.amount;
  $("detailEditDate").value = t.date;
  $("detailEditNote").value = t.note || "";
  $("detailEditSource").value = t.source || "";
  $("detailOverlay").classList.add("open");
}

function openCardDetail(item) {
  const c = item.raw;
  activeItem = item;
  resetSheetControls();
  $("detailEditToggle").classList.add("hidden");
  $("detailManageCardLink").classList.remove("hidden");

  $("detailIcon").textContent = "💳";
  $("detailIconWrap").style.background = item.tint;
  const amtEl = $("detailAmount");
  amtEl.textContent = `-${money(c.amount)}`;
  amtEl.className = "detail-amount expense";

  $("detailCategoryLabel").textContent = "Card";
  $("detailCategory").textContent = c.cards?.name || "Card";
  $("detailAccountLabel").textContent = "Deducted from";
  $("detailAccount").textContent = "Card balance (not an account)";
  $("detailDate").textContent = fmtDate(c.date);
  $("detailPeriod").textContent = "—";

  $("detailNoteRow").classList.toggle("hidden", !c.detail);
  if (c.detail) $("detailNote").textContent = c.detail;
  $("detailOverlay").classList.add("open");
}

$("detailClose").addEventListener("click", () => $("detailOverlay").classList.remove("open"));

function renderEditFields() {
  const s = editState;
  $("detailEditTypeWrap").classList.toggle("hidden", s.locked);
  $("detailTypeLockedHint").classList.toggle("hidden", !s.locked);
  $("detailTypeExpense").classList.toggle("selected", s.type === "expense");
  $("detailTypeIncome").classList.toggle("selected", s.type === "income");
  $("detailEditCategoryWrap").classList.toggle("hidden", s.locked || s.type !== "expense");
  $("detailEditSourceWrap").classList.toggle("hidden", s.locked || s.type !== "income");

  $("detailEditCategoryPills").innerHTML = categories
    .filter((c) => !c.is_system)
    .map((c) => ({ c, label: pathLabel(c) }))
    .sort((a, b) => a.label.localeCompare(b.label))
    .map(({ c, label }) => `<button type="button" class="pill ${c.id === s.categoryId ? "selected" : ""}" data-cat-id="${c.id}">${esc(c.icon || "🏷️")} ${esc(label)}</button>`)
    .join("");
}

// Debt repayments, debt-created entries and card top-ups are tied to other records.
async function isLinkedTransaction(id) {
  const [d, c] = await Promise.all([
    supabase.from("debt_activity").select("id").eq("transaction_id", id).limit(1),
    supabase.from("card_activity").select("id").eq("transaction_id", id).limit(1),
  ]);
  if (d.error || c.error) return true;
  return (d.data || []).length > 0 || (c.data || []).length > 0;
}

$("detailEditToggle").addEventListener("click", async () => {
  const item = activeItem;
  if (!item || item.kind !== "tx") return;
  const t = item.raw;

  ["detailEditRow", "detailEditDateWrap", "detailEditNoteWrap", "detailSaveEdit", "detailDelete"]
    .forEach((id) => $(id).classList.remove("hidden"));
  $("detailEditToggle").classList.add("hidden");

  editState = { type: t.type, categoryId: t.type === "expense" ? t.category_id : null, locked: true };
  renderEditFields();

  const linked = await isLinkedTransaction(t.id);
  if (activeItem !== item) return;
  editState.locked = linked;
  renderEditFields();
});

$("detailEditTypeWrap").addEventListener("click", (e) => {
  const pill = e.target.closest("[data-edit-type]");
  if (!pill || editState.locked) return;
  editState.type = pill.dataset.editType;
  renderEditFields();
});

$("detailEditCategoryPills").addEventListener("click", (e) => {
  const pill = e.target.closest("[data-cat-id]");
  if (!pill || editState.locked) return;
  editState.categoryId = pill.dataset.catId;
  renderEditFields();
});

$("detailSaveEdit").addEventListener("click", async () => {
  const saveBtn = $("detailSaveEdit");
  if (saveBtn.disabled || !activeItem || activeItem.kind !== "tx") return;
  const t = activeItem.raw;
  const newAmount = parseFloat($("detailEditAmount").value);
  const newDate = $("detailEditDate").value;
  const newNote = $("detailEditNote").value.trim() || null;
  if (!newAmount || newAmount <= 0 || !newDate) return;

  const s = editState;
  const newType = s.locked ? t.type : s.type;
  if (!s.locked && newType === "expense" && t.type === "income" && !s.categoryId) {
    alert("Pick a category for this expense.");
    return;
  }

  saveBtn.disabled = true;

  const payload = { amount: newAmount, date: newDate, note: newNote };
  if (!s.locked) {
    payload.type = newType;
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

  const effect = (type, amt) => (type === "income" ? Number(amt) : -Number(amt));
  const balanceDelta = effect(newType, newAmount) - effect(t.type, t.amount);
  if (t.account_id && Math.abs(balanceDelta) > 0.0001) {
    const { data: account } = await supabase.from("accounts").select("*").eq("id", t.account_id).single();
    if (account) {
      const newBalance = Math.round((Number(account.balance) + balanceDelta) * 100) / 100;
      await supabase.from("accounts").update({ balance: newBalance }).eq("id", t.account_id);
    }
  }

  $("detailOverlay").classList.remove("open");
  activeItem = null;
  await loadData();
  render();
});

$("detailDelete").addEventListener("click", async () => {
  const deleteBtn = $("detailDelete");
  if (deleteBtn.disabled || !activeItem || activeItem.kind !== "tx") return;
  if (!confirm("Delete this transaction? This will also reverse its effect on the account balance.")) return;
  deleteBtn.disabled = true;

  const t = activeItem.raw;
  if (t.account_id) {
    const { data: account } = await supabase.from("accounts").select("*").eq("id", t.account_id).single();
    if (account) {
      const revert = t.type === "expense" ? Number(t.amount) : -Number(t.amount);
      await supabase.from("accounts").update({ balance: Math.round((Number(account.balance) + revert) * 100) / 100 }).eq("id", t.account_id);
    }
  }
  await supabase.from("transactions").delete().eq("id", t.id);

  $("detailOverlay").classList.remove("open");
  activeItem = null;
  await loadData();
  render();
});

attachSwipeToDismiss($("detailOverlay"), $("detailOverlay").querySelector(".sheet-handle"), () => $("detailOverlay").classList.remove("open"));

attachNoteSuggest($("detailEditNote"), "note");
attachNoteSuggest($("detailEditSource"), "source");

// ---------- init ----------
(async function init() {
  await loadData();
  render();
  input.focus();
})();
