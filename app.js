const supabaseClient = window.supabase.createClient(
  window.SUPABASE_CONFIG.url,
  window.SUPABASE_CONFIG.publishableKey
);

const tbody = document.getElementById("products-tbody");
const searchInput = document.getElementById("search-input");
const summaryTotal = document.getElementById("summary-total");
const summaryLow = document.getElementById("summary-low");

const productDialog = document.getElementById("product-dialog");
const productForm = document.getElementById("product-form");
const productDialogTitle = document.getElementById("product-dialog-title");
const deleteProductBtn = document.getElementById("delete-product-btn");

const movementDialog = document.getElementById("movement-dialog");
const movementForm = document.getElementById("movement-form");
const movementType = document.getElementById("movement-type");
const movementQtyLabel = document.getElementById("movement-qty-label");

const toastEl = document.getElementById("toast");

let products = [];
let searchTerm = "";

function showToast(message, isError = false) {
  toastEl.textContent = message;
  toastEl.classList.toggle("error", isError);
  toastEl.hidden = false;
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => { toastEl.hidden = true; }, 3000);
}

function formatPrice(price) {
  if (price === null || price === undefined) return "-";
  return `¥${Number(price).toLocaleString("ja-JP")}`;
}

function renderProducts() {
  const term = searchTerm.trim().toLowerCase();
  const filtered = products.filter((p) => {
    if (!term) return true;
    return (
      p.name.toLowerCase().includes(term) ||
      (p.sku || "").toLowerCase().includes(term)
    );
  });

  summaryTotal.textContent = products.length;
  summaryLow.textContent = products.filter(
    (p) => p.low_stock_threshold > 0 && p.quantity <= p.low_stock_threshold
  ).length;

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="6">${
      products.length === 0 ? "商品がまだありません" : "該当する商品がありません"
    }</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered
    .map((p) => {
      const isLow = p.low_stock_threshold > 0 && p.quantity <= p.low_stock_threshold;
      return `
        <tr class="${isLow ? "low-stock" : ""}" data-id="${p.id}">
          <td>${escapeHtml(p.name)}</td>
          <td>${escapeHtml(p.sku || "-")}</td>
          <td>${escapeHtml(p.category || "-")}</td>
          <td><span class="qty-badge ${isLow ? "low" : ""}">${p.quantity} ${escapeHtml(p.unit || "")}</span></td>
          <td>${formatPrice(p.price)}</td>
          <td>
            <div class="row-actions">
              <button class="btn btn-sm move-btn" data-id="${p.id}">入出庫</button>
              <button class="btn btn-sm edit-btn" data-id="${p.id}">編集</button>
            </div>
          </td>
        </tr>
      `;
    })
    .join("");
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

async function loadProducts() {
  const { data, error } = await supabaseClient
    .from("products")
    .select("*")
    .order("name", { ascending: true });

  if (error) {
    showToast(`読み込みエラー: ${error.message}`, true);
    return;
  }
  products = data;
  renderProducts();
}

// --- 商品追加・編集ダイアログ ---

function openProductDialog(product = null) {
  productForm.reset();
  document.getElementById("field-unit").value = "個";
  document.getElementById("field-quantity").value = 0;
  document.getElementById("field-low-threshold").value = 0;

  if (product) {
    productDialogTitle.textContent = "商品を編集";
    document.getElementById("product-id").value = product.id;
    document.getElementById("field-name").value = product.name;
    document.getElementById("field-sku").value = product.sku || "";
    document.getElementById("field-category").value = product.category || "";
    document.getElementById("field-quantity").value = product.quantity;
    document.getElementById("field-unit").value = product.unit || "個";
    document.getElementById("field-low-threshold").value = product.low_stock_threshold;
    document.getElementById("field-price").value = product.price ?? "";
    document.getElementById("field-notes").value = product.notes || "";
    deleteProductBtn.hidden = false;
  } else {
    productDialogTitle.textContent = "商品を追加";
    document.getElementById("product-id").value = "";
    deleteProductBtn.hidden = true;
  }
  productDialog.showModal();
}

document.getElementById("add-product-btn").addEventListener("click", () => openProductDialog());
document.getElementById("cancel-dialog-btn").addEventListener("click", () => productDialog.close());

productForm.addEventListener("submit", async () => {
  const id = document.getElementById("product-id").value;
  const payload = {
    name: document.getElementById("field-name").value.trim(),
    sku: document.getElementById("field-sku").value.trim() || null,
    category: document.getElementById("field-category").value.trim() || null,
    quantity: Number(document.getElementById("field-quantity").value) || 0,
    unit: document.getElementById("field-unit").value.trim() || "個",
    low_stock_threshold: Number(document.getElementById("field-low-threshold").value) || 0,
    price: document.getElementById("field-price").value === "" ? null : Number(document.getElementById("field-price").value),
    notes: document.getElementById("field-notes").value.trim() || null,
  };

  if (!payload.name) {
    showToast("商品名を入力してください", true);
    return;
  }

  const query = id
    ? supabaseClient.from("products").update(payload).eq("id", id)
    : supabaseClient.from("products").insert(payload);

  const { error } = await query;
  if (error) {
    showToast(`保存エラー: ${error.message}`, true);
    return;
  }
  showToast("保存しました");
  await loadProducts();
});

deleteProductBtn.addEventListener("click", async () => {
  const id = document.getElementById("product-id").value;
  if (!id) return;
  if (!confirm("この商品を削除しますか?入出庫履歴も削除されます。")) return;

  const { error } = await supabaseClient.from("products").delete().eq("id", id);
  if (error) {
    showToast(`削除エラー: ${error.message}`, true);
    return;
  }
  productDialog.close();
  showToast("削除しました");
  await loadProducts();
});

// --- 入出庫ダイアログ ---

let movementProduct = null;

function openMovementDialog(product) {
  movementProduct = product;
  movementForm.reset();
  document.getElementById("movement-product-name").textContent = `${product.name}(現在庫: ${product.quantity} ${product.unit || ""})`;
  movementType.value = "in";
  document.getElementById("movement-quantity").value = 1;
  updateMovementQtyLabel();
  movementDialog.showModal();
}

function updateMovementQtyLabel() {
  movementQtyLabel.firstChild.textContent =
    movementType.value === "adjust" ? "調整後の数量" : "数量";
}
movementType.addEventListener("change", updateMovementQtyLabel);

document.getElementById("cancel-movement-btn").addEventListener("click", () => movementDialog.close());

movementForm.addEventListener("submit", async () => {
  if (!movementProduct) return;
  const type = movementType.value;
  const qtyInput = Number(document.getElementById("movement-quantity").value);
  const note = document.getElementById("movement-note").value.trim() || null;

  if (!Number.isFinite(qtyInput) || qtyInput < 0) {
    showToast("数量を正しく入力してください", true);
    return;
  }

  let newQuantity;
  let quantityChange;
  if (type === "in") {
    quantityChange = qtyInput;
    newQuantity = movementProduct.quantity + qtyInput;
  } else if (type === "out") {
    quantityChange = -qtyInput;
    newQuantity = movementProduct.quantity - qtyInput;
    if (newQuantity < 0) {
      showToast("在庫数がマイナスになります", true);
      return;
    }
  } else {
    quantityChange = qtyInput - movementProduct.quantity;
    newQuantity = qtyInput;
  }

  const { error: updateError } = await supabaseClient
    .from("products")
    .update({ quantity: newQuantity })
    .eq("id", movementProduct.id);

  if (updateError) {
    showToast(`更新エラー: ${updateError.message}`, true);
    return;
  }

  const { error: movementError } = await supabaseClient.from("stock_movements").insert({
    product_id: movementProduct.id,
    change_type: type,
    quantity_change: quantityChange,
    note,
  });

  if (movementError) {
    showToast(`履歴登録エラー: ${movementError.message}`, true);
    return;
  }

  showToast("在庫を更新しました");
  await loadProducts();
});

// --- テーブル内ボタン(イベント委譲) ---

tbody.addEventListener("click", (e) => {
  const editBtn = e.target.closest(".edit-btn");
  const moveBtn = e.target.closest(".move-btn");
  if (editBtn) {
    const product = products.find((p) => p.id === editBtn.dataset.id);
    if (product) openProductDialog(product);
  } else if (moveBtn) {
    const product = products.find((p) => p.id === moveBtn.dataset.id);
    if (product) openMovementDialog(product);
  }
});

searchInput.addEventListener("input", (e) => {
  searchTerm = e.target.value;
  renderProducts();
});

// --- バーコードスキャン ---

const scanDialog = document.getElementById("scan-dialog");
const scanVideo = document.getElementById("scan-video");
const scanStatus = document.getElementById("scan-status");
const scanBarcodeBtn = document.getElementById("scan-barcode-btn");
const cancelScanBtn = document.getElementById("cancel-scan-btn");

let scanControls = null;

function stopScan() {
  if (scanControls) {
    scanControls.stop();
    scanControls = null;
  }
}

async function handleScannedCode(code) {
  stopScan();
  scanDialog.close();

  const product = products.find((p) => (p.sku || "").trim() === code.trim());
  if (product) {
    showToast(`スキャン: ${product.name}`);
    openMovementDialog(product);
  } else {
    showToast("未登録のバーコードです。商品名を入力してください", true);
    openProductDialog();
    document.getElementById("field-sku").value = code;
  }
}

async function startScan() {
  scanStatus.textContent = "カメラを起動しています…";
  scanDialog.showModal();

  if (typeof ZXingBrowser === "undefined") {
    scanStatus.textContent = "バーコード読み取りライブラリを読み込めませんでした";
    return;
  }

  try {
    const codeReader = new ZXingBrowser.BrowserMultiFormatReader();
    scanStatus.textContent = "バーコードにカメラを向けてください";
    // facingMode を直接指定(iOS Safari は権限取得前 enumerateDevices のラベルが空になり
    // 背面カメラの判定ができないため、deviceId ではなく constraints で直接要求する)
    scanControls = await codeReader.decodeFromConstraints(
      { audio: false, video: { facingMode: { ideal: "environment" } } },
      scanVideo,
      (result, err) => {
        if (result) {
          handleScannedCode(result.getText());
        }
      }
    );
  } catch (err) {
    scanStatus.textContent = `カメラを起動できませんでした: ${err.message}`;
  }
}

scanBarcodeBtn.addEventListener("click", startScan);
cancelScanBtn.addEventListener("click", () => {
  stopScan();
  scanDialog.close();
});
scanDialog.addEventListener("close", stopScan);

loadProducts();
