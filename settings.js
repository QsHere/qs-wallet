import { supabase } from "./db.js";

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
        <span class="tree-name">${cat.name}</span>
        <span class="tree-actions">
          <button class="tree-btn" data-add="${cat.id}">+ sub</button>
          <button class="tree-btn danger" data-del="${cat.id}">Delete</button>
        </span>
      </div>
      <div class="inline-add hidden" id="add-${cat.id}">
        <input type="text" placeholder="Subcategory name" class="amount-input small-input" id="input-${cat.id}" />
        <button class="btn btn-confirm small-btn" data-confirm="${cat.id}">Add</button>
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
    const input = document.getElementById(`input-${id}`);
    const name = input.value.trim();
    if (name) {
      await supabase.from("categories").insert({ name, parent_id: id });
      await loadTree();
    }
  }
});

document.getElementById("addTopCategory").addEventListener("click", async () => {
  const input = document.getElementById("newTopCategory");
  const name = input.value.trim();
  if (!name) return;
  await supabase.from("categories").insert({ name, parent_id: null });
  input.value = "";
  await loadTree();
});

loadTree();
