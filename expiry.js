const expiryTbody = document.getElementById("expiry-items-tbody");
const expiryDialog = document.getElementById("expiry-item-dialog");
const expiryForm = document.getElementById("expiry-item-form");
const expiryBarcode = document.getElementById("expiry-field-barcode");
const expiryProductName = document.getElementById("expiry-field-product-name");
const expiryLookupStatus = document.getElementById("expiry-lookup-status");
const expiryPeriodFilter = document.getElementById("expiry-period-filter");
const expirySearchInput = document.getElementById("expiry-search-input");
const expiryExportBtn = document.getElementById("expiry-export-btn");
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

function buildExpiryExportRows(items) {
  const grouped = new Map();
  items.forEach((item) => {
    // 同じ棚・商品・期限で分かれて登録された在庫は1行に合計する。
    const key = [item.location, item.barcode, item.product_name, item.expires_on].join("\u0000");
    const existing = grouped.get(key);
    if (existing) {
      existing.quantity += Number(item.quantity) || 0;
    } else {
      grouped.set(key, {
        location: item.location || "",
        productName: item.product_name || "",
        quantity: Number(item.quantity) || 0,
        expiresOn: item.expires_on || "",
      });
    }
  });

  return [...grouped.values()].sort((a, b) =>
    a.location.localeCompare(b.location, "ja", { numeric: true }) ||
    a.productName.localeCompare(b.productName, "ja", { numeric: true }) ||
    a.expiresOn.localeCompare(b.expiresOn)
  );
}

function escapeCsvValue(value) {
  let text = String(value ?? "");
  // Excelで商品名や棚名が数式として実行されないようにする。
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

function exportExpiryItems() {
  if (!expiryItems.length) {
    showToast("出力できる賞味期限商品がありません", true);
    return;
  }

  const rows = buildExpiryExportRows(expiryItems);
  const csvRows = [
    ["棚（置き場所）", "商品名", "在庫数", "期限"],
    ...rows.map((row) => [row.location, row.productName, row.quantity, row.expiresOn]),
  ];
  const csv = `\uFEFF${csvRows.map((row) => row.map(escapeCsvValue).join(",")).join("\r\n")}`;
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `賞味期限一覧_${todayStr()}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  showToast("棚ごとの賞味期限一覧を出力しました");
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
  const code = normalizeBarcode(barcode);
  const sequence = ++expiryLookupSequence;
  if (!code) { expiryLookupStatus.textContent = ""; return; }

  expiryBarcode.value = code;

  expiryLookupStatus.textContent = "商品名を検索しています…";
  try {
    const result = await findProductByBarcode(code, products);
    if (sequence !== expiryLookupSequence) return;
    if (result.name) {
      expiryProductName.value = result.name;
      expiryLookupStatus.textContent = result.source === "local"
        ? "登録済みの商品から商品名を取得しました"
        : "商品データベースから商品名を取得しました";
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
expiryExportBtn.addEventListener("click", exportExpiryItems);
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
  if (!isValidGtin(payload.barcode)) {
    showToast("JANには正しい8・12・13・14桁のバーコード番号を入力してください", true);
    expiryBarcode.focus();
    return;
  }

  let productNameWasCorrected = false;
  try {
    const registered = await findProductByBarcode(payload.barcode, products);
    if (registered.name && registered.name !== payload.product_name) {
      payload.product_name = registered.name;
      expiryProductName.value = registered.name;
      productNameWasCorrected = true;
    }
  } catch (error) {
    // 商品名照合が一時的に失敗しても、品出し登録自体は止めない。
  }

  const query = id
    ? supabaseClient.from("expiry_items").update(payload).eq("id", id)
    : supabaseClient.from("expiry_items").insert(payload);
  const { error } = await query;
  if (error) { showToast(`保存エラー: ${error.message}`, true); return; }
  expiryDialog.close();
  showToast(productNameWasCorrected
    ? `登録済みの商品名「${payload.product_name}」に修正して保存しました`
    : "品出し情報を保存しました");
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
    const reader = new ZXingBrowser.BrowserMultiFormatReader();
    expiryScanStatus.textContent = "バーコードにカメラを向けてください";
    expiryScanControls = await reader.decodeFromConstraints(
      { audio: false, video: { facingMode: { ideal: "environment" } } },
      document.getElementById("expiry-scan-video"),
      (result) => {
        if (!result) return;
        const code = result.getText();
        if (!isValidGtin(code)) {
          expiryScanStatus.textContent = "QRコードは対象外です。数字のバーコードを枠内に入れてください";
          return;
        }
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
