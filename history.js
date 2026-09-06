import { supabase, money } from "./db.js";

let transactions = [];
let editingId = null;

async function loadHistory() {
  const { data, error } = await supabase
    .from("transactions")
    .select("*, accounts(name), categories(name, icon)")
    .order("date", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) { console.error(error); return; }
  transactions = data;
  render();
}

function groupByDate(list) {
  const groups = {};
  list.forEach((t) => { (groups[t.date] ||= []).push(t); });
  return groups;
}

function render() {
  const groups = groupByDate(transactions);
  const dates = Object.keys(groups).sort((a, b) => b.localeCompare(a));

  document.getElementById("historyList").innerHTML = dates.length
    ? dates.map((date) => {
        const rows = groups[date].map(rowHTML).join("");
        const label = new Date(date + "T00:00:00").toLocaleDateString("en-GB", {
          weekday: "short", day: "numeric", month: "short",
        });
        return `<div class="history-group"><div class="history-date">${label}</div><ul class="recent-list">${rows}</ul></div>`;
      }).join("")
    : `<p class="empty-note">No transactions yet.</p>`;
}

function rowHTML(t) {
  const isIncome = t.type === "income";
  const label = isIncome ? (t.source || "Income") : (t.categories?.name || "Expense");
  const icon = isIncome ? "💰" : (t.categories?.icon || "🏷️");
  const sign = isIncome ? "+" : "-";
  const period = t.time_period ? ` · ${t.time_period}` : "";
  return `<li class="tappable" data-id="${t.id}">
    <span class="recent-left">
      <span class="recent-icon">${icon}</span>
      <span>
        <div class="recent-cat">${label}</div>
        <div class="recent-meta">${t.accounts?.name || ""}${period}</div>
      </span>
    </span>
    <span class="recent-amt ${t.type}">${sign}${money(t.amount)}</span>
  </li>`;
}

document.getElementById("historyList").addEventListener("click", (e) => {
  const row = e.target.closest("[data-id]");
  if (!row) return;
  openEdit(row.dataset.id);
});

function openEdit(id) {
  const t = transactions.find((x) => x.id === id);
  editingId = id;
  const label = t.type === "income" ? (t.source || "Income") : (t.categories?.name || "Expense");
  document.getElementById("editLabel").textContent = label;
  document.getElementById("editAmount").value = t.amount;
  document.getElementById("editOverlay").classList.add("open");
}

document.getElementById("editClose").addEventListener("click", () => {
  document.getElementById("editOverlay").classList.remove("open");
});

document.getElementById("saveEdit").addEventListener("click", async () => {
  const t = transactions.find((x) => x.id === editingId);
  const newAmount = parseFloat(document.getElementById("editAmount").value);
  if (!newAmount || newAmount <= 0) return;

  const diff = newAmount - Number(t.amount);
  const { data: account } = await supabase.from("accounts").select("*").eq("id", t.account_id).single();
  const balanceDelta = t.type === "expense" ? -diff : diff;
  await supabase.from("accounts").update({ balance: Number(account.balance) + balanceDelta }).eq("id", t.account_id);
  await supabase.from("transactions").update({ amount: newAmount }).eq("id", editingId);

  document.getElementById("editOverlay").classList.remove("open");
  await loadHistory();
});

document.getElementById("deleteEntry").addEventListener("click", async () => {
  const ok = confirm("Delete this transaction? This will also reverse its effect on the account balance.");
  if (!ok) return;

  const t = transactions.find((x) => x.id === editingId);
  const { data: account } = await supabase.from("accounts").select("*").eq("id", t.account_id).single();
  const revert = t.type === "expense" ? Number(t.amount) : -Number(t.amount);
  await supabase.from("accounts").update({ balance: Number(account.balance) + revert }).eq("id", t.account_id);
  await supabase.from("transactions").delete().eq("id", editingId);

  document.getElementById("editOverlay").classList.remove("open");
  await loadHistory();
});

loadHistory();
