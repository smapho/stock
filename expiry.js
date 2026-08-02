const expiryTbody = document.getElementById("expiry-items-tbody");
const expiryDialog = document.getElementById("expiry-item-dialog");
const expiryForm = document.getElementById("expiry-item-form");
const expiryBarcode = document.getElementById("expiry-field-barcode");
const expiryProductName = document.getElementById("expiry-field-product-name");
const expiryLookupStatus = document.getElementById("expiry-lookup-status");
const expiryPeriodFilter = document.getElementById("expiry-period-filter");
const expirySearchInput = document.getElementById("expiry-search-input");
const deleteExpiryItemBtn = document.getElementById("delete-expiry-item-btn");

let expiryItems = [];
let expiryLookupTimer = null;
let expiryLookupSequence = 0;
let expiryScanControls = null;
let expiryScanHintTimer = null;

function localDateFromIso(value) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function daysUntil(value) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((localDateFromIso(value) - today) / 86400000);
}

function expiryLabel(days) {
  if (days < 0) return `${Math.abs(days)}日超過`;
  if (days === 0) return "本日まで";
  return `あと${days}日`;
}

function renderExpiryItems() {
  const term = expirySearchInput.value.trim().toLowerCase();
  const period = expiryPeriodFilter.value;
  const withDays = expiryItems.map((item) => ({ ...item, days: daysUntil(item.expires_on) }));

  document.getElementById("expiry-summary-expired").textContent = withDays.filter((i) => i.days < 0).length;
  document.getElementById("expiry-summary-soon").textContent = withDays.filter((i) => i.days >= 0 && i.days <= 7).length;
  document.getElementById("expiry-summary-month").textContent = withDays.filter((i) => i.days >= 0 && i.days <= 30).length;

  const filtered = withDays.filter((item) => {
    if (period === "expired" && item.days >= 0) return false;
    if (period === "7" && (item.days < 0 || item.days > 7)) return false;
    if (period === "30" && (item.days < 0 || item.days > 30)) return false;
    if (!term) return true;
    return [item.product_name, item.barcode, item.location].some((v) => (v || "").toLowerCase().includes(term));
  });

  if (!filtered.length) {
    expiryTbody.innerHTML = `<tr class="empty-row"><td colspan="6">${expiryItems.length ? "該当する商品がありません" : "品出し登録がまだありません"}</td></tr>`;
    return;
  }

  expiryTbody.innerHTML = filtered.map((item) => {
    const state = item.days < 0 ? "expired" : item.days <= 7 ? "soon" : "";
    return `<tr class="${state ? `expiry-${state}` : ""}">
      <td class="expiry-date ${state}">${escapeHtml(item.expires_on)}<span class="expiry-days">${expiryLabel(item.days)}</span></td>
      <td>${escapeHtml(item.product_name)}</td>
      <td>${escapeHtml(item.barcode)}</td>
      <td>${escapeHtml(item.location)}</td>
      <td>${item.quantity}</td>
      <td><button type="button" class="btn btn-sm expiry-edit-btn" data-id="${item.id}">編集</button></td>
    </tr>`;
  }).join("");
}

async function loadExpiryItems() {
  const { data, error } = await supabaseClient.from("expiry_items").select("*").order("expires_on");
  if (error) {
    expiryTbody.innerHTML = '<tr class="empty-row"><td colspan="6">賞味期限テーブルの準備が必要です</td></tr>';
    showToast(`賞味期限の読み込みエラー: ${error.message}`, true);
    return;
  }
  expiryItems = data || [];
  renderExpiryItems();
}

async function lookupProductName(barcode) {
  const code = barcode.trim();
  const sequence = ++expiryLookupSequence;
  if (!code) { expiryLookupStatus.textContent = ""; return; }

  const localProduct = products.find((p) => (p.sku || "").trim() === code);
  if (localProduct) {
    expiryProductName.value = localProduct.name;
    expiryLookupStatus.textContent = "登録済みの商品から商品名を取得しました";
    return;
  }

  expiryLookupStatus.textContent = "商品名を検索しています…";
  try {
    const response = await fetch(`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json?fields=product_name,product_name_ja`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const result = await response.json();
    if (sequence !== expiryLookupSequence) return;
    const name = result.product?.product_name_ja || result.product?.product_name;
    if (result.status === 1 && name) {
      expiryProductName.value = name;
      expiryLookupStatus.textContent = "商品データベースから商品名を取得しました";
    } else {
      expiryLookupStatus.textContent = "商品名が見つかりません。手入力してください";
      expiryProductName.focus();
    }
  } catch (error) {
    if (sequence !== expiryLookupSequence) return;
    expiryLookupStatus.textContent = "商品名を取得できませんでした。手入力してください";
  }
}

function openExpiryDialog(item = null) {
  expiryForm.reset();
  document.getElementById("expiry-field-quantity").value = 1;
  document.getElementById("expiry-item-id").value = item?.id || "";
  expiryBarcode.value = item?.barcode || "";
  expiryProductName.value = item?.product_name || "";
  document.getElementById("expiry-field-date").value = item?.expires_on || "";
  document.getElementById("expiry-field-location").value = item?.location || "";
  document.getElementById("expiry-field-quantity").value = item?.quantity || 1;
  document.getElementById("expiry-field-notes").value = item?.notes || "";
  expiryLookupStatus.textContent = "";
  deleteExpiryItemBtn.hidden = !item;
  expiryDialog.showModal();
  if (!item) expiryBarcode.focus();
}

document.getElementById("add-expiry-item-btn").addEventListener("click", () => openExpiryDialog());
document.getElementById("cancel-expiry-item-btn").addEventListener("click", () => expiryDialog.close());
expirySearchInput.addEventListener("input", renderExpiryItems);
expiryPeriodFilter.addEventListener("change", renderExpiryItems);

expiryBarcode.addEventListener("input", () => {
  clearTimeout(expiryLookupTimer);
  expiryLookupTimer = setTimeout(() => lookupProductName(expiryBarcode.value), 450);
});
expiryBarcode.addEventListener("change", () => lookupProductName(expiryBarcode.value));

expiryForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const id = document.getElementById("expiry-item-id").value;
  const payload = {
    barcode: expiryBarcode.value.trim(),
    product_name: expiryProductName.value.trim(),
    expires_on: document.getElementById("expiry-field-date").value,
    location: document.getElementById("expiry-field-location").value.trim(),
    quantity: Number(document.getElementById("expiry-field-quantity").value),
    notes: document.getElementById("expiry-field-notes").value.trim() || null,
  };
  if (!payload.barcode || !payload.product_name || !payload.expires_on || !payload.location || payload.quantity < 1) {
    showToast("必須項目を正しく入力してください", true);
    return;
  }
  const query = id
    ? supabaseClient.from("expiry_items").update(payload).eq("id", id)
    : supabaseClient.from("expiry_items").insert(payload);
  const { error } = await query;
  if (error) { showToast(`保存エラー: ${error.message}`, true); return; }
  expiryDialog.close();
  showToast("品出し情報を保存しました");
  await loadExpiryItems();
});

deleteExpiryItemBtn.addEventListener("click", async () => {
  const id = document.getElementById("expiry-item-id").value;
  if (!id || !confirm("この品出し登録を削除しますか?")) return;
  const { error } = await supabaseClient.from("expiry_items").delete().eq("id", id);
  if (error) { showToast(`削除エラー: ${error.message}`, true); return; }
  expiryDialog.close();
  showToast("削除しました");
  await loadExpiryItems();
});

expiryTbody.addEventListener("click", (event) => {
  const button = event.target.closest(".expiry-edit-btn");
  if (!button) return;
  const item = expiryItems.find((candidate) => candidate.id === button.dataset.id);
  if (item) openExpiryDialog(item);
});

const expiryScanDialog = document.getElementById("expiry-scan-dialog");
const expiryScanStatus = document.getElementById("expiry-scan-status");
function stopExpiryScan() {
  clearTimeout(expiryScanHintTimer);
  if (expiryScanControls) { expiryScanControls.stop(); expiryScanControls = null; }
}
async function startExpiryScan() {
  expiryScanDialog.showModal();
  expiryScanStatus.textContent = "カメラを起動しています…";
  if (typeof ZXingBrowser === "undefined") { expiryScanStatus.textContent = "読取ライブラリを読み込めませんでした"; return; }
  try {
    const Reader = ZXingBrowser.BrowserMultiFormatOneDReader || ZXingBrowser.BrowserMultiFormatReader;
    const reader = new Reader();
    expiryScanStatus.textContent = "バーコードにカメラを向けてください";
    expiryScanControls = await reader.decodeFromConstraints(
      {
        audio: false,
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1280 },
          height: { ideal: 720 },
          focusMode: "continuous",
        },
      },
      document.getElementById("expiry-scan-video"),
      (result) => {
        if (!result) return;
        const code = result.getText();
        stopExpiryScan();
        expiryScanDialog.close();
        expiryBarcode.value = code;
        lookupProductName(code);
      }
    );
    expiryScanHintTimer = setTimeout(() => {
      expiryScanStatus.textContent = "読み取り中… バーコード全体を枠内に入れ、少し離して合わせてください";
    }, 6000);
  } catch (error) { expiryScanStatus.textContent = `カメラを起動できませんでした: ${error.message}`; }
}
document.getElementById("expiry-scan-btn").addEventListener("click", startExpiryScan);
document.getElementById("cancel-expiry-scan-btn").addEventListener("click", () => expiryScanDialog.close());
expiryScanDialog.addEventListener("close", stopExpiryScan);
document.addEventListener("tab-activated", (event) => { if (event.detail.tab === "expiry") loadExpiryItems(); });
loadExpiryItems();
