import { supabase, money, colorFor } from "./db.js";

let viewYear, viewMonth; // viewMonth is 0-indexed
let monthTx = []; // all transactions (income+expense) in the viewed month
let activeDetailId = null;

const today = new Date();
viewYear = today.getFullYear();
viewMonth = today.getMonth();

function pad(n) { return String(n).padStart(2, "0"); }
function isoDate(y, m, d) { return `${y}-${pad(m + 1)}-${pad(d)}`; }

async function loadMonth() {
  const start = isoDate(viewYear, viewMonth, 1);
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const end = isoDate(viewYear, viewMonth, daysInMonth);

  const { data, error } = await supabase
    .from("transactions")
    .select("*, accounts(name), categories(name, icon)")
    .gte("date", start)
    .lte("date", end);
  if (error) { console.error(error); monthTx = []; } else { monthTx = data || []; }

  renderCalendar();
}

function renderCalendar() {
  const monthNames = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  document.getElementById("monthLabel").textContent = `${monthNames[viewMonth]} ${viewYear}`;

  const firstWeekday = new Date(viewYear, viewMonth, 1).getDay(); // 0 = Sunday
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();

  const perDaySpend = {};
  monthTx.forEach((t) => {
    if (t.type !== "expense") return;
    perDaySpend[t.date] = (perDaySpend[t.date] || 0) + Number(t.amount);
  });

  const totalCells = Math.ceil((firstWeekday + daysInMonth) / 7) * 7;
  const grid = document.getElementById("calGrid");
  let html = "";

  for (let i = 0; i < totalCells; i++) {
    const dayNum = i - firstWeekday + 1;
    if (dayNum < 1 || dayNum > daysInMonth) {
      html += `<div class="cal-cell empty"></div>`;
      continue;
    }
    const dateStr = isoDate(viewYear, viewMonth, dayNum);
    const spend = perDaySpend[dateStr];
    const isToday = dateStr === isoDate(today.getFullYear(), today.getMonth(), today.getDate());
    html += `<button type="button" class="cal-cell ${spend ? "has-data" : ""} ${isToday ? "today" : ""}" data-date="${dateStr}">
      <span class="cal-day-num">${dayNum}</span>
      ${spend ? `<span class="cal-day-amt">${spend.toFixed(0)}</span>` : ""}
    </button>`;
  }
  grid.innerHTML = html;
}

document.getElementById("calGrid").addEventListener("click", (e) => {
  const cell = e.target.closest(".cal-cell");
  if (!cell || cell.classList.contains("empty")) return;
  openDay(cell.dataset.date);
});

// ---------- Month navigation ----------
function goToMonth(y, m) {
  viewYear = y;
  viewMonth = m;
  if (viewMonth < 0) { viewMonth = 11; viewYear--; }
  if (viewMonth > 11) { viewMonth = 0; viewYear++; }
  loadMonth();
}

document.getElementById("prevMonth")?.addEventListener("click", () => goToMonth(viewYear, viewMonth - 1));
document.getElementById("nextMonth")?.addEventListener("click", () => goToMonth(viewYear, viewMonth + 1));

// Swipe left/right anywhere on the calendar page to change month
let touchStartX = null;
let touchStartY = null;
const swipeArea = document.querySelector(".history-page");
swipeArea.addEventListener("touchstart", (e) => {
  touchStartX = e.touches[0].clientX;
  touchStartY = e.touches[0].clientY;
}, { passive: true });
swipeArea.addEventListener("touchend", (e) => {
  if (touchStartX === null) return;
  const deltaX = e.changedTouches[0].clientX - touchStartX;
  const deltaY = e.changedTouches[0].clientY - touchStartY;
  if (Math.abs(deltaX) > 50 && Math.abs(deltaX) > Math.abs(deltaY)) {
    if (deltaX < 0) goToMonth(viewYear, viewMonth + 1);
    else goToMonth(viewYear, viewMonth - 1);
  }
  touchStartX = null;
  touchStartY = null;
});

// ---------- Month/year picker ----------
document.getElementById("monthLabel").addEventListener("click", () => {
  const yearPills = document.getElementById("yearPills");
  const nowYear = today.getFullYear();
  const years = [nowYear - 2, nowYear - 1, nowYear, nowYear + 1];
  yearPills.innerHTML = years.map((y) => `<button type="button" class="pill ${y === viewYear ? "selected" : ""}" data-year="${y}">${y}</button>`).join("");

  const monthNamesShort = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const monthPills = document.getElementById("monthPills");
  monthPills.innerHTML = monthNamesShort.map((m, i) => `<button type="button" class="pill ${i === viewMonth ? "selected" : ""}" data-month="${i}">${m}</button>`).join("");

  document.getElementById("monthPickerOverlay").classList.add("open");
});

document.getElementById("monthPickerClose").addEventListener("click", () => {
  document.getElementById("monthPickerOverlay").classList.remove("open");
});

document.getElementById("yearPills").addEventListener("click", (e) => {
  const pill = e.target.closest(".pill");
  if (!pill) return;
  document.querySelectorAll("#yearPills .pill").forEach((p) => p.classList.remove("selected"));
  pill.classList.add("selected");
  goToMonth(Number(pill.dataset.year), viewMonth);
});

document.getElementById("monthPills").addEventListener("click", (e) => {
  const pill = e.target.closest(".pill");
  if (!pill) return;
  document.querySelectorAll("#monthPills .pill").forEach((p) => p.classList.remove("selected"));
  pill.classList.add("selected");
  goToMonth(viewYear, Number(pill.dataset.month));
  document.getElementById("monthPickerOverlay").classList.remove("open");
});

// ---------- Day detail (list of that day's transactions) ----------
function openDay(dateStr) {
  const dayTx = monthTx.filter((t) => t.date === dateStr).sort((a, b) => b.created_at.localeCompare(a.created_at));

  const [y, m, d] = dateStr.split("-").map(Number);
  const label = new Date(y, m - 1, d).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
  document.getElementById("dayTitle").textContent = label;

  document.getElementById("dayList").innerHTML = dayTx.length
    ? dayTx.map(rowHTML).join("")
    : `<li class="empty-note">No transactions this day.</li>`;

  document.getElementById("dayOverlay").classList.add("open");
}

function rowHTML(t) {
  const isIncome = t.type === "income";
  const label = isIncome ? (t.source || "Income") : (t.categories?.name || "Expense");
  const icon = isIncome ? "💰" : (t.categories?.icon || "🏷️");
  const tint = isIncome ? "#30D15833" : colorFor(label) + "33";
  const sign = isIncome ? "+" : "-";
  return `<li class="tappable" data-id="${t.id}">
    <span class="row-left">
      <span class="row-icon" style="background:${tint}">${icon}</span>
      <span>
        <div class="row-title">${label}</div>
        <div class="row-meta">${t.accounts?.name || ""}${t.time_period ? " · " + t.time_period : ""}</div>
      </span>
    </span>
    <span class="row-amt ${t.type}">${sign}${money(t.amount)}</span>
  </li>`;
}

document.getElementById("dayClose").addEventListener("click", () => {
  document.getElementById("dayOverlay").classList.remove("open");
});

document.getElementById("dayList").addEventListener("click", (e) => {
  const row = e.target.closest("[data-id]");
  if (!row) return;
  openDetail(row.dataset.id);
});

// ---------- Transaction detail / edit ----------
function openDetail(id) {
  const t = monthTx.find((x) => x.id === id);
  if (!t) return;
  activeDetailId = id;
  const isIncome = t.type === "income";
  const label = isIncome ? (t.source || "Income") : (t.categories?.name || "Expense");
  const icon = isIncome ? "💰" : (t.categories?.icon || "🏷️");
  const tint = isIncome ? "#30D15833" : colorFor(label) + "33";

  document.getElementById("detailIcon").textContent = icon;
  document.getElementById("detailIconWrap").style.background = tint;
  const amtEl = document.getElementById("detailAmount");
  amtEl.textContent = `${isIncome ? "+" : "-"}${money(t.amount)}`;
  amtEl.className = `detail-amount ${t.type}`;

  document.getElementById("detailCategory").textContent = label;
  document.getElementById("detailAccount").textContent = t.accounts?.name || "—";
  document.getElementById("detailDate").textContent = t.date;
  document.getElementById("detailPeriod").textContent = t.time_period || "—";

  const noteRow = document.getElementById("detailNoteRow");
  if (t.note) {
    noteRow.classList.remove("hidden");
    document.getElementById("detailNote").textContent = t.note;
  } else {
    noteRow.classList.add("hidden");
  }

  document.getElementById("detailEditRow").classList.add("hidden");
  document.getElementById("detailEditDateWrap").classList.add("hidden");
  document.getElementById("detailEditNoteWrap").classList.add("hidden");
  document.getElementById("detailSaveEdit").classList.add("hidden");
  document.getElementById("detailEditToggle").classList.remove("hidden");
  document.getElementById("detailEditAmount").value = t.amount;
  document.getElementById("detailEditDate").value = t.date;
  document.getElementById("detailEditNote").value = t.note || "";

  document.getElementById("detailOverlay").classList.add("open");
}

document.getElementById("detailClose").addEventListener("click", () => {
  document.getElementById("detailOverlay").classList.remove("open");
});

document.getElementById("detailEditToggle").addEventListener("click", () => {
  document.getElementById("detailEditRow").classList.remove("hidden");
  document.getElementById("detailEditDateWrap").classList.remove("hidden");
  document.getElementById("detailEditNoteWrap").classList.remove("hidden");
  document.getElementById("detailSaveEdit").classList.remove("hidden");
  document.getElementById("detailEditToggle").classList.add("hidden");
});

document.getElementById("detailSaveEdit").addEventListener("click", async () => {
  const t = monthTx.find((x) => x.id === activeDetailId);
  const newAmount = parseFloat(document.getElementById("detailEditAmount").value);
  const newDate = document.getElementById("detailEditDate").value;
  const newNote = document.getElementById("detailEditNote").value.trim() || null;
  if (!newAmount || newAmount <= 0 || !newDate) return;

  const diff = newAmount - Number(t.amount);
  const { data: account } = await supabase.from("accounts").select("*").eq("id", t.account_id).single();
  const balanceDelta = t.type === "expense" ? -diff : diff;
  await supabase.from("accounts").update({ balance: Number(account.balance) + balanceDelta }).eq("id", t.account_id);
  await supabase.from("transactions").update({ amount: newAmount, date: newDate, note: newNote }).eq("id", activeDetailId);

  document.getElementById("detailOverlay").classList.remove("open");
  document.getElementById("dayOverlay").classList.remove("open");
  await loadMonth();
});

document.getElementById("detailDelete").addEventListener("click", async () => {
  const ok = confirm("Delete this transaction? This will also reverse its effect on the account balance.");
  if (!ok) return;

  const t = monthTx.find((x) => x.id === activeDetailId);
  const { data: account } = await supabase.from("accounts").select("*").eq("id", t.account_id).single();
  const revert = t.type === "expense" ? Number(t.amount) : -Number(t.amount);
  await supabase.from("accounts").update({ balance: Number(account.balance) + revert }).eq("id", t.account_id);
  await supabase.from("transactions").delete().eq("id", activeDetailId);

  document.getElementById("detailOverlay").classList.remove("open");
  document.getElementById("dayOverlay").classList.remove("open");
  await loadMonth();
});

loadMonth();
