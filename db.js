import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
export const money = (n) => `RM ${Number(n).toFixed(2)}`;
export const todayISO = () => new Date().toISOString().slice(0, 10);

// Rough default for the time-of-day picker, based on the clock right now.
// Purely a suggestion — the person can always override it.
export function defaultPeriod() {
  const h = new Date().getHours();
  if (h >= 5 && h < 12) return "morning";
  if (h >= 12 && h < 18) return "noon";
  if (h >= 18 && h < 24) return "night";
  return "midnight"; // 0-4am
}

// Deterministic accent color per name, so each category/person keeps a
// consistent tile color across the app without needing manual assignment.
const PALETTE = ["#FF453A", "#FF9F0A", "#FFD60A", "#30D158", "#64D2FF", "#0A84FF", "#5E5CE6", "#BF5AF2", "#FF375F"];
export function colorFor(text) {
  let hash = 0;
  for (let i = 0; i < text.length; i++) hash = text.charCodeAt(i) + ((hash << 5) - hash);
  return PALETTE[Math.abs(hash) % PALETTE.length];
}

// Animates a number counting up/down inside an element — used for the hero figure.
export function animateNumber(el, to, { prefix = "RM ", duration = 500 } = {}) {
  const from = parseFloat((el.dataset.value || "0"));
  const start = performance.now();
  function tick(now) {
    const progress = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - progress, 3);
    const value = from + (to - from) * eased;
    el.textContent = `${prefix}${value.toFixed(2)}`;
    if (progress < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
  el.dataset.value = to;
}

// Light haptic tap — works on Android Chrome (incl. as installed PWA). No-op elsewhere.
export function haptic(ms = 10) {
  if (navigator.vibrate) navigator.vibrate(ms);
}

// iOS-style toast that slides down from the top, then fades out.
export function toast(message) {
  let el = document.getElementById("qs-toast");
  if (!el) {
    el = document.createElement("div");
    el.id = "qs-toast";
    el.className = "qs-toast";
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.classList.remove("show");
  void el.offsetWidth; // restart animation
  el.classList.add("show");
  clearTimeout(el._timer);
  el._timer = setTimeout(() => el.classList.remove("show"), 1800);
}

// Animates a number counting up/down to its target value over `duration` ms.
export function animateCount(el, from, to, duration = 650, formatter = (n) => n.toFixed(2)) {
  const start = performance.now();
  function tick(now) {
    const progress = Math.min((now - start) / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3); // ease-out cubic
    const value = from + (to - from) * eased;
    el.textContent = `RM ${formatter(value)}`;
    if (progress < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

// Adds swipe-down-to-dismiss to a bottom sheet via its drag handle.
export function attachSwipeToDismiss(overlayEl, handleEl, onDismiss) {
  let startY = 0, currentY = 0, dragging = false;
  const sheet = overlayEl.querySelector(".sheet");

  const start = (y) => { dragging = true; startY = y; sheet.style.transition = "none"; };
  const move = (y) => {
    if (!dragging) return;
    currentY = Math.max(0, y - startY);
    sheet.style.transform = `translateY(${currentY}px)`;
  };
  const end = () => {
    if (!dragging) return;
    dragging = false;
    sheet.style.transition = "";
    if (currentY > 90) {
      onDismiss();
    }
    sheet.style.transform = "";
  };

  handleEl.addEventListener("touchstart", (e) => start(e.touches[0].clientY), { passive: true });
  handleEl.addEventListener("touchmove", (e) => move(e.touches[0].clientY), { passive: true });
  handleEl.addEventListener("touchend", end);
}
