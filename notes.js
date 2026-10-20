import { supabase, localISO } from "./db.js";

// Typing suggestions for note / source boxes, learned from everything you've saved before.
// - "note" pool:   every note on any transaction (spend notes, edited notes, ...)
// - "source" pool: income sources
// History is loaded lazily the first time a suggest-enabled box is used, then kept in memory.

const PAGE = 1000;
const MAX_ROWS = 5000;      // most recent entries only
const MAX_SUGGESTIONS = 5;

// Notes the app writes by itself (card top-ups, debt repayments, ...) are not worth suggesting
const SYSTEM_NOTE = /^(top up:|repayment (to|from) |debt with )/i;

const norm = (s) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
const reEscape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// kind -> Map(normalisedText -> { count, last, variants: Map(exactText -> count) })
const pools = { note: new Map(), source: new Map() };
let loaded = false;
let loadPromise = null;

function addToPool(kind, text, date) {
  const clean = String(text ?? "").trim().replace(/\s+/g, " ");
  if (!clean || SYSTEM_NOTE.test(clean)) return;
  const key = norm(clean);
  const pool = pools[kind];
  let entry = pool.get(key);
  if (!entry) {
    entry = { count: 0, last: "", variants: new Map() };
    pool.set(key, entry);
  }
  entry.count += 1;
  if ((date || "") > entry.last) entry.last = date || "";
  entry.variants.set(clean, (entry.variants.get(clean) || 0) + 1);
}

async function loadPools() {
  for (let from = 0; from < MAX_ROWS; from += PAGE) {
    const { data, error } = await supabase
      .from("transactions")
      .select("note, source, type, date")
      .or("note.not.is.null,source.not.is.null")
      .order("date", { ascending: false })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    for (const row of data) {
      addToPool("note", row.note, row.date);
      addToPool("source", row.source, row.date);
    }
    if (data.length < PAGE) break;
  }
  loaded = true;
}

function ensureLoaded() {
  if (!loadPromise) {
    loadPromise = loadPools().catch((err) => {
      console.error("Couldn't load note suggestions:", err);
      setTimeout(() => { loadPromise = null; }, 30000); // allow a retry later
    });
  }
  return loadPromise;
}

// Call after saving something so the new text is suggested straight away.
export function rememberNote(text, kind = "note") {
  if (!loaded) return; // it will be picked up when history loads
  addToPool(kind, text, localISO(new Date()));
}

// The way a suggestion is spelled = the variant you've used most often
function displayOf(entry) {
  let best = null, bestCount = -1;
  for (const [text, count] of entry.variants) {
    if (count > bestCount) { best = text; bestCount = count; }
  }
  return best;
}

// Best matches first: starts-with, then a word starts with it, then contains it.
// Within each group: most used, then most recent.
export function suggest(kind, query, limit = MAX_SUGGESTIONS) {
  const q = norm(query).trim().replace(/\s+/g, " ");
  if (!q) return [];
  const hits = [];
  for (const [key, entry] of pools[kind]) {
    if (key === q) continue; // already typed in full
    let tier;
    if (key.startsWith(q)) tier = 0;
    else if ((" " + key).includes(" " + q)) tier = 1;
    else if (q.length >= 2 && key.includes(q)) tier = 2;
    else continue;
    hits.push({ key, entry, tier });
  }
  hits.sort((a, b) =>
    a.tier - b.tier ||
    b.entry.count - a.entry.count ||
    b.entry.last.localeCompare(a.entry.last) ||
    a.key.localeCompare(b.key));
  return hits.slice(0, limit).map((h) => displayOf(h.entry));
}

// Bolds the part you typed: its first occurrence, preferring the start of a word
function highlightMatch(text, query) {
  const str = String(text);
  const q = query.trim();
  if (!q) return esc(str);
  const atWordStart = new RegExp(`(^|\\s)(${reEscape(q)})`, "i").exec(str);
  const idx = atWordStart ? atWordStart.index + atWordStart[1].length : str.toLowerCase().indexOf(q.toLowerCase());
  if (idx < 0) return esc(str);
  return esc(str.slice(0, idx)) + `<b>${esc(str.slice(idx, idx + q.length))}</b>` + esc(str.slice(idx + q.length));
}

// Adds the suggestion list to a text input. `kind` is "note" or "source".
export function attachNoteSuggest(input, kind = "note") {
  if (!input || input.dataset.noteSuggest) return;
  input.dataset.noteSuggest = "1";
  input.setAttribute("autocomplete", "off"); // stop the browser's own autofill clashing with ours

  const wrap = document.createElement("div");
  wrap.className = "note-suggest-wrap";
  input.parentNode.insertBefore(wrap, input);
  wrap.appendChild(input);

  const list = document.createElement("ul");
  list.className = "note-suggest hidden";
  list.setAttribute("role", "listbox");
  wrap.appendChild(list);

  let suppressNext = false;

  const hide = () => {
    list.classList.add("hidden");
    list.classList.remove("below");
    list.innerHTML = "";
  };

  // Opens upward by default (the keyboard covers anything below the box);
  // flips below only if there isn't room above.
  function place() {
    list.classList.remove("below");
    const rect = input.getBoundingClientRect();
    const listHeight = list.offsetHeight;
    if (!rect.height || !listHeight) return;
    const sheet = input.closest(".sheet");
    const topLimit = Math.max(sheet ? sheet.getBoundingClientRect().top : 0, 0);
    const vv = window.visualViewport;
    const bottomLimit = vv ? vv.offsetTop + vv.height : window.innerHeight;
    const above = rect.top - topLimit;
    const below = bottomLimit - rect.bottom;
    if (above < listHeight + 8 && below > above) list.classList.add("below");
  }

  async function refresh() {
    const text = input.value;
    if (!text.trim()) { hide(); return; }
    await ensureLoaded();
    if (input.value !== text || document.activeElement !== input) return; // typed on / left meanwhile
    const items = suggest(kind, text);
    if (!items.length) { hide(); return; }
    list.innerHTML = items
      .map((t) => `<li role="option" data-text="${esc(t)}">${highlightMatch(t, text)}</li>`)
      .join("");
    list.classList.remove("hidden");
    place();
  }

  input.addEventListener("input", () => {
    if (suppressNext) { suppressNext = false; return; }
    refresh();
  });
  input.addEventListener("focus", () => { ensureLoaded(); }); // history loads on first use; the list itself only appears as you type
  input.addEventListener("blur", hide);
  input.addEventListener("keydown", (e) => { if (e.key === "Escape") hide(); });

  // Keep focus on the box while tapping a suggestion (otherwise it blurs and the list vanishes first)
  list.addEventListener("mousedown", (e) => e.preventDefault());
  list.addEventListener("click", (e) => {
    const item = e.target.closest("li");
    if (!item) return;
    input.value = item.dataset.text;
    suppressNext = true;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    suppressNext = false;
    hide();
    input.focus();
    try { input.setSelectionRange(input.value.length, input.value.length); } catch { /* not supported */ }
  });

  // Closing the sheet should never leave a list behind
  const overlay = input.closest(".sheet-overlay");
  if (overlay) {
    new MutationObserver(() => { if (!overlay.classList.contains("open")) hide(); })
      .observe(overlay, { attributes: true, attributeFilter: ["class"] });
  }
}
