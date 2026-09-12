import { getReminderSettings, setReminderSettings, enableTabSwipe } from "./db.js";

const toggle = document.getElementById("reminderToggle");
const timeRow = document.getElementById("reminderTimeRow");
const timeInput = document.getElementById("reminderTime");
const note = document.getElementById("reminderNote");

function render() {
  const settings = getReminderSettings();
  toggle.checked = settings.enabled;
  timeInput.value = settings.time;
  timeRow.classList.toggle("hidden", !settings.enabled);

  if (!("Notification" in window)) {
    note.textContent = "Notifications aren't supported in this browser.";
  } else if (settings.enabled && Notification.permission === "granted") {
    note.textContent = `You'll get a nudge around ${settings.time} — but only if you happen to open the app around then. This is a browser reminder, not a guaranteed background alarm.`;
  } else if (settings.enabled && Notification.permission === "denied") {
    note.textContent = "Notifications are blocked for this site in your browser settings — enable them there for this to work.";
  } else {
    note.textContent = "Get a gentle nudge to log your spending when you open the app after this time each day.";
  }
}

toggle.addEventListener("change", async () => {
  if (toggle.checked) {
    if (!("Notification" in window)) {
      toggle.checked = false;
      render();
      return;
    }
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      toggle.checked = false;
      setReminderSettings({ enabled: false, time: timeInput.value });
      render();
      return;
    }
  }
  setReminderSettings({ enabled: toggle.checked, time: timeInput.value });
  render();
});

timeInput.addEventListener("change", () => {
  setReminderSettings({ enabled: toggle.checked, time: timeInput.value });
  render();
});

document.getElementById("goAccounts").addEventListener("click", () => {
  window.location.href = "accounts.html";
});

document.getElementById("goCategories").addEventListener("click", () => {
  window.location.href = "categories.html";
});

render();

enableTabSwipe({ prev: "debts.html" });
