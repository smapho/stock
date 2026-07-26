const supabaseClient = window.supabase.createClient(
  window.SUPABASE_CONFIG.url,
  window.SUPABASE_CONFIG.publishableKey
);

const toastEl = document.getElementById("toast");

function showToast(message, isError = false) {
  toastEl.textContent = message;
  toastEl.classList.toggle("error", isError);
  toastEl.hidden = false;
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => { toastEl.hidden = true; }, 3000);
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

function formatYen(amount) {
  if (amount === null || amount === undefined || Number.isNaN(amount)) return "-";
  return `¥${Math.round(Number(amount)).toLocaleString("ja-JP")}`;
}

function formatPercent(rate) {
  return `${Math.round(Number(rate) * 100)}%`;
}

// select.value = String(0.10) は "0.1" になり <option value="0.10"> と一致しないため、
// 数値として比較して一致するオプションを選択する(税率セレクトのバグ対策)。
function setSelectByNumericValue(selectEl, value, fallback) {
  const target = Number(value);
  const match = [...selectEl.options].find((o) => o.value !== "" && Number(o.value) === target);
  selectEl.value = match ? match.value : fallback;
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// --- タブ切り替え ---
document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    const tab = btn.dataset.tab;
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.toggle("active", b === btn));
    document.querySelectorAll("[data-tab-panel]").forEach((panel) => {
      panel.hidden = panel.dataset.tabPanel !== tab;
    });
    document.dispatchEvent(new CustomEvent("tab-activated", { detail: { tab } }));
  });
});
