import { supabase, colorFor } from "./db.js";

let categories = [];

async function loadTree() {
  const { data, error } = await supabase.from("categories").select("*").order("name");
  if (error) { console.error(error); return; }
  categories = data;
  render();
}

function childrenOf(parentId) {
  return categories.filter((c) => c.parent_id === parentId);
}

function renderNode(cat) {
  const kids = childrenOf(cat.id);
  return `
    <li class="tree-item">
      <div class="tree-row">
        <span class="tree-name"><span class="tile-mini" style="background:${colorFor(cat.name)}33">${cat.icon || "🏷️"}</span>${cat.name}</span>
        <span class="tree-actions">
          <button class="tree-btn" data-edit="${cat.id}">Edit</button>
          <button class="tree-btn" data-add="${cat.id}">+ sub</button>
          <button class="tree-btn danger" data-del="${cat.id}">Delete</button>
        </span>
      </div>
      <div class="inline-add hidden" id="edit-${cat.id}">
        <input type="text" value="${cat.icon || "🏷️"}" class="text-input icon-input" id="edit-icon-${cat.id}" maxlength="4" />
        <input type="text" value="${cat.name}" class="text-input" id="edit-name-${cat.id}" />
        <button class="small-btn btn-confirm" data-save-edit="${cat.id}">Save</button>
      </div>
      <div class="inline-add hidden" id="add-${cat.id}">
        <input type="text" placeholder="🏷️" class="text-input icon-input" id="icon-${cat.id}" maxlength="4" />
        <input type="text" placeholder="Subcategory name" class="text-input" id="input-${cat.id}" />
        <button class="small-btn btn-confirm" data-confirm="${cat.id}">Add</button>
      </div>
      ${kids.length ? `<ul class="tree-children">${kids.map(renderNode).join("")}</ul>` : ""}
    </li>
  `;
}

function render() {
  const roots = childrenOf(null);
  const tree = document.getElementById("categoryTree");
  tree.innerHTML = roots.length
    ? roots.map(renderNode).join("")
    : `<li class="empty-note">No categories yet — add your first one above.</li>`;
}

document.getElementById("categoryTree").addEventListener("click", async (e) => {
  const addBtn = e.target.closest("[data-add]");
  const delBtn = e.target.closest("[data-del]");
  const confirmBtn = e.target.closest("[data-confirm]");
  const editBtn = e.target.closest("[data-edit]");
  const saveEditBtn = e.target.closest("[data-save-edit]");

  if (editBtn) {
    document.getElementById(`edit-${editBtn.dataset.edit}`).classList.toggle("hidden");
    return;
  }

  if (saveEditBtn) {
    const id = saveEditBtn.dataset.saveEdit;
    const name = document.getElementById(`edit-name-${id}`).value.trim();
    const icon = document.getElementById(`edit-icon-${id}`).value.trim() || "🏷️";
    if (name) {
      await supabase.from("categories").update({ name, icon }).eq("id", id);
      await loadTree();
    }
    return;
  }

  if (addBtn) {
    document.getElementById(`add-${addBtn.dataset.add}`).classList.toggle("hidden");
    return;
  }

  if (delBtn) {
    const ok = confirm("Delete this category? Any subcategories under it will be deleted too.");
    if (ok) {
      await supabase.from("categories").delete().eq("id", delBtn.dataset.del);
      await loadTree();
    }
    return;
  }

  if (confirmBtn) {
    const id = confirmBtn.dataset.confirm;
    const nameInput = document.getElementById(`input-${id}`);
    const iconInput = document.getElementById(`icon-${id}`);
    const name = nameInput.value.trim();
    const icon = iconInput.value.trim() || "🏷️";
    if (name) {
      await supabase.from("categories").insert({ name, icon, parent_id: id });
      await loadTree();
    }
  }
});

document.getElementById("addTopCategory").addEventListener("click", async () => {
  const nameInput = document.getElementById("newTopCategory");
  const iconInput = document.getElementById("newTopIcon");
  const name = nameInput.value.trim();
  const icon = iconInput.value.trim() || "🏷️";
  if (!name) return;
  await supabase.from("categories").insert({ name, icon, parent_id: null });
  nameInput.value = "";
  iconInput.value = "";
  await loadTree();
});

loadTree();
