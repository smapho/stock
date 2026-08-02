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

// --- マスタ登録時の二重登録・表記ゆれチェック ---
function levenshteinDistance(a, b) {
  const dp = [];
  for (let i = 0; i <= a.length; i++) dp.push([i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return dp[a.length][b.length];
}

function normalizeForCompare(name) {
  return name.trim().toLowerCase().replace(/\s+/g, "");
}

// 完全一致(大小文字/空白違いのみ)・部分一致・編集距離の近さ、いずれかで「似ている」と判定する
function findSimilarNames(newName, existingItems, excludeId) {
  const target = normalizeForCompare(newName);
  return existingItems.filter((item) => {
    if (item.id === excludeId) return false;
    const candidate = normalizeForCompare(item.name);
    if (!candidate || !target) return false;
    if (candidate === target) return true;
    if (candidate.includes(target) || target.includes(candidate)) return true;
    const threshold = Math.max(1, Math.floor(Math.min(candidate.length, target.length) / 4));
    return levenshteinDistance(candidate, target) <= threshold;
  });
}

function formatDateOnly(isoString) {
  if (!isoString) return "-";
  return isoString.slice(0, 10);
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// --- バーコード商品名検索 ---
function normalizeBarcode(value) {
  const withoutPrefix = String(value || "").trim().replace(/^sku\s*:\s*/i, "");
  return /^[\d\s-]+$/.test(withoutPrefix)
    ? withoutPrefix.replace(/[^\d]/g, "")
    : withoutPrefix;
}

// JAN/EAN/UPC/GTIN の数字とチェックデジットを確認する。
// MultiFormatReader は商品上のQRコードも読むため、URLなどをJANとして扱わない。
function isValidGtin(value) {
  const code = normalizeBarcode(value);
  if (!/^\d+$/.test(code) || ![8, 12, 13, 14].includes(code.length)) return false;

  const checkDigit = Number(code.at(-1));
  const body = code.slice(0, -1);
  let sum = 0;
  for (let index = body.length - 1, position = 1; index >= 0; index -= 1, position += 1) {
    sum += Number(body[index]) * (position % 2 === 1 ? 3 : 1);
  }
  return (10 - (sum % 10)) % 10 === checkDigit;
}

async function findProductByBarcode(value, existingProducts = []) {
  const code = normalizeBarcode(value);
  if (!code) return { code, name: null, source: null };

  const localProduct = existingProducts.find((product) => normalizeBarcode(product.barcode) === code);
  if (localProduct) return { code, name: localProduct.name, source: "local", product: localProduct };

  const response = await fetch(
    `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json?fields=product_name,product_name_ja`
  );
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const result = await response.json();
  const name = result.product?.product_name_ja || result.product?.product_name || null;
  return { code, name: result.status === 1 ? name : null, source: name ? "openfoodfacts" : null };
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
