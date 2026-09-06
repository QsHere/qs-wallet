import { supabase, money } from "./db.js";

let chart;
let currentPeriod = "week";

const PALETTE = ["#C9A24B", "#C1533E", "#6E8F87", "#A6785C", "#4F6D66", "#B98B3E", "#7A4B3A", "#8C6E4B"];

function rangeFor(period) {
  const now = new Date();
  if (period === "week") {
    const day = now.getDay(); // 0 = Sunday
    const diffToMonday = (day === 0 ? -6 : 1) - day;
    const monday = new Date(now);
    monday.setDate(now.getDate() + diffToMonday);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    return { start: monday.toISOString().slice(0, 10), end: sunday.toISOString().slice(0, 10) };
  }
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

async function loadChart() {
  const { start, end } = rangeFor(currentPeriod);
  const { data, error } = await supabase
    .from("transactions")
    .select("amount, categories(name)")
    .eq("type", "expense")
    .gte("date", start)
    .lte("date", end);
  if (error) { console.error(error); return; }

  const totals = {};
  (data || []).forEach((t) => {
    const label = t.categories?.name || "Uncategorized";
    totals[label] = (totals[label] || 0) + Number(t.amount);
  });

  const labels = Object.keys(totals);
  const values = Object.values(totals);
  const colors = labels.map((_, i) => PALETTE[i % PALETTE.length]);
  const total = values.reduce((a, b) => a + b, 0);
  document.getElementById("totalAmount").textContent = money(total);

  if (chart) chart.destroy();
  const ctx = document.getElementById("pieChart").getContext("2d");
  chart = new Chart(ctx, {
    type: "pie",
    data: {
      labels,
      datasets: [{ data: values, backgroundColor: colors, borderColor: "#1B2E2B", borderWidth: 2 }],
    },
    options: { plugins: { legend: { display: false } } },
  });

  document.getElementById("legendList").innerHTML = labels.length
    ? labels
        .map((label, i) => {
          const pct = total ? Math.round((totals[label] / total) * 100) : 0;
          return `<li>
            <span><span class="legend-dot" style="background:${colors[i]}"></span>${label}</span>
            <span class="legend-amt">${money(totals[label])} · ${pct}%</span>
          </li>`;
        })
        .join("")
    : `<li class="empty-note">No expenses in this period.</li>`;
}

function setPeriod(period) {
  currentPeriod = period;
  document.getElementById("btnWeek").classList.toggle("active", period === "week");
  document.getElementById("btnMonth").classList.toggle("active", period === "month");
  positionThumb();
  loadChart();
}

function positionThumb() {
  const activeBtn = document.querySelector(".toggle-btn.active");
  const thumb = document.getElementById("segThumb");
  thumb.style.width = `${activeBtn.offsetWidth}px`;
  thumb.style.transform = `translateX(${activeBtn.offsetLeft - 4}px)`;
}

document.getElementById("btnWeek").addEventListener("click", () => setPeriod("week"));
document.getElementById("btnMonth").addEventListener("click", () => setPeriod("month"));

window.addEventListener("load", positionThumb);
positionThumb();
loadChart();
