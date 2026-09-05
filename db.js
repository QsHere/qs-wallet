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
