import { enableTabSwipe } from "./db.js";

document.getElementById("goAccounts").addEventListener("click", () => {
  window.location.href = "accounts.html";
});

document.getElementById("goCategories").addEventListener("click", () => {
  window.location.href = "categories.html";
});

enableTabSwipe({ prev: "debts.html" });
