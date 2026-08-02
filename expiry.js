const expiryTbody = document.getElementById("expiry-items-tbody");
const expiryDialog = document.getElementById("expiry-item-dialog");
const expiryForm = document.getElementById("expiry-item-form");
const expiryBarcode = document.getElementById("expiry-field-barcode");
const expiryProductName = document.getElementById("expiry-field-product-name");
const expiryLookupStatus = document.getElementById("expiry-lookup-status");
const expiryPeriodFilter = document.getElementById("expiry-period-filter");
const expirySearchInput = document.getElementById("expiry-search-input");
const expiryExportBtn = document.getElementById("expiry-export-btn");
const shelfInventoryCsvBtn = document.getElementById("shelf-inventory-csv-btn");
const shelfInventoryPdfBtn = document.getElementById("shelf-inventory-pdf-btn");
const shelfInventoryPrintView = document.getElementById("shelf-inventory-print-view");
const inventoryDetailDialog = document.getElementById("inventory-detail-dialog");
const inventoryDetailContent = document.getElementById("inventory-detail-content");
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

function matchesExpiryPeriod(days, period) {
  if (period === "today") return days === 0;
  if (period === "7") return days >= 0 && days <= 7;
  if (period === "31") return days >= 0 && days <= 31;
  if (period === "expired") return days < 0;
  return true;
}

function normalizeExpirySearchToken(value) {
  return String(value || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[ァ-ヶ]/g, (character) => String.fromCharCode(character.charCodeAt(0) - 0x60))
    .replace(/[^\p{L}\p{N}ー]/gu, "");
}

function fuzzyTextIncludes(value, normalizedTerm) {
  const normalizedValue = normalizeExpirySearchToken(value);
  if (!normalizedTerm) return true;
  if (normalizedValue.includes(normalizedTerm)) return true;
  if (normalizedTerm.length < 3) return false;

  const allowedDistance = Math.min(3, Math.max(1, Math.floor(normalizedTerm.length / 4)));
  const minLength = Math.max(1, normalizedTerm.length - allowedDistance);
  const maxLength = Math.min(normalizedValue.length, normalizedTerm.length + allowedDistance);
  for (let length = minLength; length <= maxLength; length += 1) {
    for (let start = 0; start + length <= normalizedValue.length; start += 1) {
      const candidate = normalizedValue.slice(start, start + length);
      if (levenshteinDistance(candidate, normalizedTerm) <= allowedDistance) return true;
    }
  }
  return false;
}

function matchesExpirySearch(item, searchValue) {
  const tokens = String(searchValue || "")
    .normalize("NFKC")
    .trim()
    .split(/\s+/)
    .map(normalizeExpirySearchToken)
    .filter(Boolean);
  if (!tokens.length) return true;

  const barcode = String(item.barcode || "").replace(/\D/g, "");
  return tokens.every((token) => {
    if (/^\d+$/.test(token)) {
      return barcode.includes(token) ||
        normalizeExpirySearchToken(item.product_name).includes(token) ||
        normalizeExpirySearchToken(item.location).includes(token);
    }
    return fuzzyTextIncludes(item.product_name, token) || fuzzyTextIncludes(item.location, token);
  });
}

function getFilteredExpiryItems() {
  const term = expirySearchInput.value;
  const period = expiryPeriodFilter.value;
  return expiryItems
    .map((item) => ({ ...item, days: daysUntil(item.expires_on) }))
    .filter((item) => {
      if (!matchesExpiryPeriod(item.days, period)) return false;
      return matchesExpirySearch(item, term);
    });
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

function buildShelfInventoryRows(items) {
  const grouped = new Map();
  items.forEach((item) => {
    const location = item.location || "棚未設定";
    const key = [location, item.barcode, item.product_name].join("\u0000");
    let row = grouped.get(key);
    if (!row) {
      row = {
        location,
        barcode: item.barcode || "",
        productName: item.product_name || "",
        quantity: 0,
        expiryQuantities: new Map(),
      };
      grouped.set(key, row);
    }
    const quantity = Number(item.quantity) || 0;
    row.quantity += quantity;
    const expiry = item.expires_on || "期限なし";
    row.expiryQuantities.set(expiry, (row.expiryQuantities.get(expiry) || 0) + quantity);
  });

  return [...grouped.values()]
    .map((row) => ({
      location: row.location,
      barcode: row.barcode,
      productName: row.productName,
      quantity: row.quantity,
      specSummary: formatProductSpecs(products.find((product) =>
        normalizeBarcode(product.barcode) === normalizeBarcode(row.barcode))?.specs),
      expiryDetails: [...row.expiryQuantities.entries()]
        .sort(([dateA], [dateB]) => dateA.localeCompare(dateB))
        .map(([date, quantity]) => `${date} (${quantity})`)
        .join(" / "),
    }))
    .sort((a, b) =>
      a.location.localeCompare(b.location, "ja", { numeric: true }) ||
      a.productName.localeCompare(b.productName, "ja", { numeric: true }) ||
      a.barcode.localeCompare(b.barcode)
    );
}

async function loadShelfInventoryRows() {
  const { data, error } = await supabaseClient
    .from("expiry_items")
    .select("barcode, product_name, expires_on, location, quantity");
  if (error) {
    showToast(`棚別在庫の読み込みエラー: ${error.message}`, true);
    return null;
  }
  const rows = buildShelfInventoryRows(data || []);
  if (!rows.length) {
    showToast("棚と数量が登録された商品がありません", true);
    return null;
  }
  return rows;
}

function escapeCsvValue(value) {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  let text = String(value ?? "");
  // Excelで商品名や棚名が数式として実行されないようにする。
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

function downloadCsvFile(filename, rows) {
  const csv = `\uFEFF${rows.map((row) => row.map(escapeCsvValue).join(",")).join("\r\n")}`;
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportExpiryItems() {
  const filteredItems = getFilteredExpiryItems();
  if (!filteredItems.length) {
    showToast("選択中の条件に該当する商品がありません", true);
    return;
  }

  const rows = buildExpiryExportRows(filteredItems);
  const csvRows = [
    ["棚（置き場所）", "商品名", "在庫数", "期限"],
    ...rows.map((row) => [row.location, row.productName, row.quantity, row.expiresOn]),
  ];
  downloadCsvFile(`賞味期限一覧_${todayStr()}.csv`, csvRows);
  showToast("棚ごとの賞味期限一覧を出力しました");
}

async function exportShelfInventoryCsv() {
  const rows = await loadShelfInventoryRows();
  if (!rows) return;
  downloadCsvFile(`棚別商品在庫_${todayStr()}.csv`, [
    ["棚（置き場所）", "商品名", "JAN", "在庫数", "仕様", "期限別内訳"],
    ...rows.map((row) => [row.location, row.productName, row.barcode, row.quantity, row.specSummary, row.expiryDetails]),
  ]);
  showToast("棚別商品在庫データを出力しました");
}

function groupShelfInventoryRows(rows) {
  const groups = new Map();
  rows.forEach((row) => {
    if (!groups.has(row.location)) groups.set(row.location, []);
    groups.get(row.location).push(row);
  });
  return [...groups.entries()];
}

function shelfRowsForProduct(product, items = expiryItems) {
  const barcode = normalizeBarcode(product?.barcode);
  if (!barcode) return [];
  return buildShelfInventoryRows(items.filter((item) => normalizeBarcode(item.barcode) === barcode));
}

function refreshInventoryDetailButtons() {
  document.querySelectorAll(".inventory-detail-btn").forEach((button) => {
    const product = products.find((candidate) => candidate.id === button.dataset.id);
    if (!product) return;
    const rows = shelfRowsForProduct(product);
    button.title = rows.length
      ? rows.map((row) => `${row.location}: ${row.quantity}（${row.expiryDetails}）`).join("\n")
      : "棚別在庫は未登録です。タップすると詳細を確認できます";
  });
}

async function showInventoryShelfDetail(product) {
  let rows = [];
  if (product.barcode) {
    const { data, error } = await supabaseClient
      .from("expiry_items")
      .select("barcode, product_name, expires_on, location, quantity")
      .eq("barcode", product.barcode);
    if (error) {
      showToast(`棚別在庫の読み込みエラー: ${error.message}`, true);
      return;
    }
    rows = buildShelfInventoryRows(data || []);
  }

  const shelfTotal = rows.reduce((sum, row) => sum + row.quantity, 0);
  const totalMatches = shelfTotal === Number(product.quantity);
  inventoryDetailContent.innerHTML = `
    <p class="inventory-detail-product"><strong>${escapeHtml(product.name)}</strong><br>JAN: ${escapeHtml(product.barcode || "未登録")}</p>
    ${productSpecEntries(product.specs).length ? `
      <dl class="inventory-detail-specs">${productSpecEntries(product.specs).map((entry) => `
        <div><dt>${escapeHtml(entry.label)}</dt><dd>${escapeHtml(entry.value)}</dd></div>
      `).join("")}</dl>
    ` : ""}
    <div class="inventory-detail-summary">
      <span>商品在庫: <strong>${Number(product.quantity) || 0} ${escapeHtml(product.unit || "")}</strong></span>
      <span>棚登録合計: <strong>${shelfTotal}</strong></span>
    </div>
    ${rows.length ? `
      <div class="table-wrap"><table>
        <thead><tr><th>棚（置き場所）</th><th>在庫数</th><th>期限別内訳</th></tr></thead>
        <tbody>${rows.map((row) => `
          <tr><td>${escapeHtml(row.location)}</td><td class="number-cell">${row.quantity}</td><td>${escapeHtml(row.expiryDetails)}</td></tr>
        `).join("")}</tbody>
      </table></div>
      ${totalMatches ? "" : '<p class="inventory-detail-warning">商品在庫と棚登録合計が一致していません。入庫時の棚登録を確認してください。</p>'}
    ` : '<p class="inventory-detail-empty">棚別在庫はまだ登録されていません。商品編集または入庫画面で賞味期限と置き場所を登録してください。</p>'}
  `;
  inventoryDetailDialog.showModal();
}

async function showShelfInventoryPdf() {
  const rows = await loadShelfInventoryRows();
  if (!rows) return;

  const groups = groupShelfInventoryRows(rows);
  const totalQuantity = rows.reduce((sum, row) => sum + row.quantity, 0);
  shelfInventoryPrintView.innerHTML = `
    <div class="print-actions">
      <button type="button" class="btn btn-primary" id="shelf-inventory-print-now-btn">🖨 印刷 / PDF保存</button>
      <button type="button" class="btn" id="shelf-inventory-print-close-btn">閉じる</button>
    </div>
    <div class="print-header">
      <h2>棚別商品在庫一覧</h2>
      <div>出力日: ${escapeHtml(todayStr())}</div>
    </div>
    <div class="shelf-inventory-print-summary">
      棚数: ${groups.length} / 商品行数: ${rows.length} / 在庫合計: ${totalQuantity}
    </div>
    ${groups.map(([location, shelfRows]) => {
      const shelfTotal = shelfRows.reduce((sum, row) => sum + row.quantity, 0);
      return `
        <section class="shelf-inventory-print-section">
          <h3>${escapeHtml(location)} <span>在庫合計 ${shelfTotal}</span></h3>
          <table>
            <thead><tr><th>商品名</th><th>JAN</th><th>在庫数</th><th>期限別内訳</th></tr></thead>
            <tbody>${shelfRows.map((row) => `
              <tr>
                <td>${escapeHtml(row.productName)}${row.specSummary ? `<span class="shelf-product-specs">${escapeHtml(row.specSummary)}</span>` : ""}</td>
                <td>${escapeHtml(row.barcode)}</td>
                <td class="number-cell">${row.quantity}</td>
                <td>${escapeHtml(row.expiryDetails)}</td>
              </tr>`).join("")}</tbody>
          </table>
        </section>`;
    }).join("")}
  `;
  shelfInventoryPrintView.hidden = false;
  document.getElementById("shelf-inventory-print-now-btn").addEventListener("click", () => window.print());
  document.getElementById("shelf-inventory-print-close-btn").addEventListener("click", () => {
    shelfInventoryPrintView.hidden = true;
    shelfInventoryPrintView.innerHTML = "";
  });
}

function renderExpiryItems() {
  const withDays = expiryItems.map((item) => ({ ...item, days: daysUntil(item.expires_on) }));

  document.getElementById("expiry-summary-expired").textContent = withDays.filter((i) => i.days < 0).length;
  document.getElementById("expiry-summary-soon").textContent = withDays.filter((i) => i.days >= 0 && i.days <= 7).length;
  document.getElementById("expiry-summary-month").textContent = withDays.filter((i) => i.days >= 0 && i.days <= 31).length;

  const filtered = getFilteredExpiryItems();

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
  refreshInventoryDetailButtons();
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
shelfInventoryCsvBtn.addEventListener("click", exportShelfInventoryCsv);
shelfInventoryPdfBtn.addEventListener("click", showShelfInventoryPdf);
document.getElementById("products-tbody").addEventListener("click", (event) => {
  const button = event.target.closest(".inventory-detail-btn");
  if (!button) return;
  const product = products.find((candidate) => candidate.id === button.dataset.id);
  if (product) showInventoryShelfDetail(product);
});
document.getElementById("close-inventory-detail-btn").addEventListener("click", () => inventoryDetailDialog.close());
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
