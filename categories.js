import { supabase, colorFor, attachSwipeToDismiss } from "./db.js";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
const norm = (s) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
const byName = (a, b) => a.name.localeCompare(b.name);

let categories = [];          // everything you can manage (system categories like "Card Top-up" are hidden)
let byId = new Map();
const expanded = new Set();   // categories whose children are showing
let query = "";
let activeId = null;          // category the action sheet is open for
let form = { mode: "add", id: null, parentId: null };

const childrenOf = (parentId) => categories.filter((c) => (c.parent_id || null) === parentId).sort(byName);

function pathOf(c) {
  const parts = [c.name];
  let cur = c;
  for (let guard = 0; cur && cur.parent_id && guard < 10; guard++) {
    cur = byId.get(cur.parent_id);
    if (cur) parts.unshift(cur.name);
  }
  return parts;
}
const pathLabel = (c) => pathOf(c).join(" › ");
const parentPathLabel = (c) => pathOf(c).slice(0, -1).join(" › ");

function descendantsOf(id) {
  const out = [];
  const stack = [id];
  while (stack.length) {
    for (const k of childrenOf(stack.pop())) { out.push(k); stack.push(k.id); }
  }
  return out;
}

async function load() {
  const { data, error } = await supabase.from("categories").select("*").order("name");
  if (error) { console.error(error); alert(`Couldn't load categories: ${error.message}`); return; }
  categories = (data || []).filter((c) => !c.is_system);
  byId = new Map(categories.map((c) => [c.id, c]));
  render();
}

// ---------- list ----------
function tile(c) {
  return `<span class="tile-mini" style="background:${colorFor(c.name)}33">${esc(c.icon || "🏷️")}</span>`;
}

function treeRow(c, depth) {
  const kids = childrenOf(c.id);
  const open = expanded.has(c.id);
  return `<div class="cat-row" data-id="${esc(c.id)}" style="padding-left:${8 + depth * 20}px">
    <button type="button" class="cat-chev ${kids.length ? "" : "none"} ${open ? "open" : ""}" data-toggle="${esc(c.id)}" aria-label="Show subcategories">›</button>
    ${tile(c)}
    <span class="cat-text"><span class="cat-name">${esc(c.name)}</span></span>
    ${kids.length ? `<span class="cat-count">${kids.length}</span>` : ""}
  </div>`;
}

function render() {
  const q = norm(query.trim());
  let html;
  if (q) {
    // searching: a flat list with each category's full path, so deep ones are one tap away
    const hits = categories.filter((c) => norm(pathLabel(c)).includes(q)).sort((a, b) => pathLabel(a).localeCompare(pathLabel(b)));
    html = hits.length
      ? `<div class="cat-list">${hits.map((c) => `<div class="cat-row" data-id="${esc(c.id)}" style="padding-left:12px">
          ${tile(c)}
          <span class="cat-text"><span class="cat-name">${esc(c.name)}</span>${parentPathLabel(c) ? `<span class="cat-path">${esc(parentPathLabel(c))}</span>` : ""}</span>
        </div>`).join("")}</div>`
      : `<p class="empty-note">No category matches “${esc(query.trim())}”.</p>`;
  } else {
    const rows = [];
    const walk = (parentId, depth) => {
      for (const c of childrenOf(parentId)) {
        rows.push(treeRow(c, depth));
        if (expanded.has(c.id)) walk(c.id, depth + 1);
      }
    };
    walk(null, 0);
    html = rows.length
      ? `<div class="cat-list">${rows.join("")}</div>`
      : `<p class="empty-note">No categories yet — tap “+ New” to add your first one.</p>`;
  }
  $("categoryTree").innerHTML = html;
}

$("catSearch").addEventListener("input", () => { query = $("catSearch").value; render(); });

$("categoryTree").addEventListener("click", (e) => {
  const chev = e.target.closest("[data-toggle]");
  if (chev) {
    const id = chev.dataset.toggle;
    if (expanded.has(id)) expanded.delete(id); else expanded.add(id);
    render();
    return;
  }
  const row = e.target.closest("[data-id]");
  if (row) openActions(row.dataset.id);
});

// ---------- actions for one category ----------
function openActions(id) {
  const c = byId.get(id);
  if (!c) return;
  activeId = id;
  $("catActionTitle").textContent = `${c.icon || "🏷️"} ${c.name}`;
  const parent = parentPathLabel(c);
  $("catActionPath").textContent = parent ? `Inside ${parent}` : "Top level";
  $("catActionOverlay").classList.add("open");
}
const closeActions = () => $("catActionOverlay").classList.remove("open");
$("catActionClose").addEventListener("click", closeActions);

$("actAddSub").addEventListener("click", () => { closeActions(); openForm("add", activeId); });
$("actEdit").addEventListener("click", () => { closeActions(); openForm("edit", activeId); });

$("actDelete").addEventListener("click", async () => {
  const c = byId.get(activeId);
  if (!c) return;
  const inside = descendantsOf(c.id).length;
  const msg = inside
    ? `Delete “${c.name}” and the ${inside} subcategor${inside === 1 ? "y" : "ies"} inside it?`
    : `Delete “${c.name}”?`;
  if (!confirm(msg)) return;
  const { error } = await supabase.from("categories").delete().eq("id", c.id);
  closeActions();
  if (error) {
    console.error(error);
    alert(`Couldn't delete “${c.name}”. It (or something inside it) is probably used by existing transactions.\n\n${error.message}`);
    return;
  }
  await load();
});

// ---------- add / edit form ----------
function openForm(mode, id) {
  form = { mode, id: mode === "edit" ? id : null, parentId: mode === "add" ? (id || null) : null };
  const c = mode === "edit" ? byId.get(id) : null;
  $("catFormTitle").textContent = mode === "edit" ? "Edit category" : "New category";
  $("catFormIcon").value = c ? (c.icon || "") : "";
  $("catFormName").value = c ? c.name : "";
  $("catParentWrap").classList.toggle("hidden", mode === "edit");
  $("catFormSave").disabled = false;
  renderParentText();
  $("catFormOverlay").classList.add("open");
}
const closeForm = () => $("catFormOverlay").classList.remove("open");
$("catFormClose").addEventListener("click", closeForm);
$("openNewCategory").addEventListener("click", () => openForm("add", null));

function renderParentText() {
  const parent = form.parentId ? byId.get(form.parentId) : null;
  $("catParentText").textContent = parent ? `${parent.icon || "🏷️"} ${pathLabel(parent)}` : "Top level";
}

$("catFormSave").addEventListener("click", async () => {
  const saveBtn = $("catFormSave");
  if (saveBtn.disabled) return;
  const name = $("catFormName").value.trim();
  const icon = $("catFormIcon").value.trim() || "🏷️";
  if (!name) return;
  saveBtn.disabled = true;

  let error;
  if (form.mode === "edit") {
    ({ error } = await supabase.from("categories").update({ name, icon }).eq("id", form.id));
  } else {
    ({ error } = await supabase.from("categories").insert({ name, icon, parent_id: form.parentId }));
    if (!error && form.parentId) {
      // open the whole chain so the new one is visible
      let cur = byId.get(form.parentId);
      while (cur) { expanded.add(cur.id); cur = cur.parent_id ? byId.get(cur.parent_id) : null; }
    }
  }
  if (error) {
    console.error(error);
    alert(`Couldn't save: ${error.message}`);
    saveBtn.disabled = false;
    return;
  }
  closeForm();
  query = "";
  $("catSearch").value = "";
  await load();
});

// ---------- parent picker (type to find the parent instead of scrolling) ----------
function renderParentList() {
  const q = norm($("parentSearch").value.trim());
  const items = categories
    .filter((c) => !q || norm(pathLabel(c)).includes(q))
    .sort((a, b) => pathLabel(a).localeCompare(pathLabel(b)));
  const top = !q
    ? `<div class="cat-row" data-parent="" style="padding-left:12px"><span class="tile-mini" style="background:var(--bg-elevated-2)">⬆️</span><span class="cat-text"><span class="cat-name">Top level (no parent)</span></span>${form.parentId ? "" : "<span>✓</span>"}</div>`
    : "";
  $("parentList").innerHTML = items.length || top
    ? `<div class="cat-list">${top}${items.map((c) => `<div class="cat-row" data-parent="${esc(c.id)}" style="padding-left:12px">
        ${tile(c)}
        <span class="cat-text"><span class="cat-name">${esc(c.name)}</span>${parentPathLabel(c) ? `<span class="cat-path">${esc(parentPathLabel(c))}</span>` : ""}</span>
        ${c.id === form.parentId ? "<span>✓</span>" : ""}
      </div>`).join("")}</div>`
    : `<p class="empty-note">No match.</p>`;
}

$("catParentBtn").addEventListener("click", () => {
  $("parentSearch").value = "";
  renderParentList();
  $("parentPickerOverlay").classList.add("open");
});
$("parentSearch").addEventListener("input", renderParentList);
$("parentList").addEventListener("click", (e) => {
  const row = e.target.closest("[data-parent]");
  if (!row) return;
  form.parentId = row.dataset.parent || null;
  renderParentText();
  $("parentPickerOverlay").classList.remove("open");
});
$("parentPickerClose").addEventListener("click", () => $("parentPickerOverlay").classList.remove("open"));

// ---------- swipe down to dismiss ----------
["catActionOverlay", "catFormOverlay", "parentPickerOverlay"].forEach((id) => {
  const overlay = $(id);
  attachSwipeToDismiss(overlay, overlay.querySelector(".sheet-handle"), () => overlay.classList.remove("open"));
});

load();
