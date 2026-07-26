const tbody = document.getElementById("products-tbody");
const searchInput = document.getElementById("search-input");
const categoryFilter = document.getElementById("category-filter");
const brandFilter = document.getElementById("brand-filter");
const summaryTotal = document.getElementById("summary-total");
const summaryLow = document.getElementById("summary-low");

const productDialog = document.getElementById("product-dialog");
const productForm = document.getElementById("product-form");
const productDialogTitle = document.getElementById("product-dialog-title");
const deleteProductBtn = document.getElementById("delete-product-btn");
const fieldCategory = document.getElementById("field-category");
const fieldPrice = document.getElementById("field-price");
const fieldPriceIncludesTax = document.getElementById("field-price-includes-tax");
const fieldTaxRate = document.getElementById("field-tax-rate");
const fieldPricePreview = document.getElementById("field-price-preview");

const movementDialog = document.getElementById("movement-dialog");
const movementForm = document.getElementById("movement-form");
const movementType = document.getElementById("movement-type");
const movementQtyLabel = document.getElementById("movement-qty-label");

const categoryDialog = document.getElementById("category-dialog");
const manageCategoriesBtn = document.getElementById("manage-categories-btn");
const closeCategoryDialogBtn = document.getElementById("close-category-dialog-btn");
const fieldBrand = document.getElementById("field-brand");
const brandDialog = document.getElementById("brand-dialog");
const manageBrandsBtn = document.getElementById("manage-brands-btn");
const closeBrandDialogBtn = document.getElementById("close-brand-dialog-btn");

let products = [];
let categories = [];
let brands = [];
let searchTerm = "";
let categoryFilterId = "";
let brandFilterId = "";

// --- マスタ(カテゴリ/ブランド)共通コントローラ ---
// 「商品ダイアログ内の簡易管理モーダル」と「マスタタブの一覧」の両方を同じデータで描画する
function createMasterController({ table, label, listElIds, addFormElIds, selectEls, onChange }) {
  const state = { items: [], editingId: null };
  const listEls = listElIds.map((id) => document.getElementById(id));
  const deleteClass = `${table}-delete-btn`;
  const editClass = `${table}-edit-btn`;
  const saveClass = `${table}-save-btn`;
  const cancelClass = `${table}-cancel-btn`;

  function render() {
    const html =
      state.items.length === 0
        ? `<li>${label}がまだありません</li>`
        : state.items
            .map((item) => {
              if (item.id === state.editingId) {
                return `
                  <li data-id="${item.id}">
                    <input type="text" class="master-edit-input" value="${escapeHtml(item.name)}" />
                    <div class="row-actions">
                      <button type="button" class="btn btn-sm btn-primary ${saveClass}" data-id="${item.id}">保存</button>
                      <button type="button" class="btn btn-sm ${cancelClass}" data-id="${item.id}">キャンセル</button>
                    </div>
                  </li>`;
              }
              return `
                  <li data-id="${item.id}">
                    <span>
                      ${escapeHtml(item.name)}
                      <span class="master-item-dates">追加: ${formatDateOnly(item.created_at)} / 変更: ${formatDateOnly(item.updated_at)}</span>
                    </span>
                    <div class="row-actions">
                      <button type="button" class="btn btn-sm ${editClass}" data-id="${item.id}">編集</button>
                      <button type="button" class="btn btn-sm btn-danger ${deleteClass}" data-id="${item.id}">削除</button>
                    </div>
                  </li>`;
            })
            .join("");
    listEls.forEach((el) => { el.innerHTML = html; });

    const options = state.items.map((item) => `<option value="${item.id}">${escapeHtml(item.name)}</option>`).join("");
    selectEls.forEach(({ el, placeholder, isFilter }) => {
      const current = el.value;
      el.innerHTML = `<option value="">${placeholder}</option>${options}`;
      if (isFilter) el.value = current || "";
    });
  }

  async function load() {
    const { data, error } = await supabaseClient.from(table).select("*").order("name");
    if (error) {
      showToast(`${label}読み込みエラー: ${error.message}`, true);
      return;
    }
    state.items = data;
    render();
    if (onChange) onChange();
  }

  addFormElIds.forEach(({ formId, inputId }) => {
    const form = document.getElementById(formId);
    const input = document.getElementById(inputId);
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const name = input.value.trim();
      if (!name) return;

      const similar = findSimilarNames(name, state.items, null);
      if (similar.length > 0) {
        const names = similar.map((i) => i.name).join("、");
        if (!confirm(`似た名前の${label}がすでにあります(${names})。それでも「${name}」を登録しますか?`)) {
          return;
        }
      }

      const { error } = await supabaseClient.from(table).insert({ name });
      if (error) {
        showToast(`追加エラー: ${error.message}`, true);
        return;
      }
      input.value = "";
      await load();
      showToast(`${label}を追加しました`);
    });
  });

  listEls.forEach((el) => {
    el.addEventListener("click", async (e) => {
      const editBtn = e.target.closest(`.${editClass}`);
      const deleteBtn = e.target.closest(`.${deleteClass}`);
      const saveBtn = e.target.closest(`.${saveClass}`);
      const cancelBtn = e.target.closest(`.${cancelClass}`);

      if (editBtn) {
        state.editingId = editBtn.dataset.id;
        render();
      } else if (cancelBtn) {
        state.editingId = null;
        render();
      } else if (saveBtn) {
        const li = saveBtn.closest("li");
        const name = li.querySelector(".master-edit-input").value.trim();
        if (!name) {
          showToast("名前を入力してください", true);
          return;
        }

        const similar = findSimilarNames(name, state.items, saveBtn.dataset.id);
        if (similar.length > 0) {
          const names = similar.map((i) => i.name).join("、");
          if (!confirm(`似た名前の${label}がすでにあります(${names})。それでも「${name}」に変更しますか?`)) {
            return;
          }
        }

        const { error } = await supabaseClient.from(table).update({ name }).eq("id", saveBtn.dataset.id);
        if (error) {
          showToast(`更新エラー: ${error.message}`, true);
          return;
        }
        state.editingId = null;
        await load();
        showToast(`${label}を更新しました`);
      } else if (deleteBtn) {
        if (!confirm(`この${label}を削除しますか?(使用中の商品がある場合は削除できません)`)) return;
        const { error } = await supabaseClient.from(table).delete().eq("id", deleteBtn.dataset.id);
        if (error) {
          showToast(`この${label}は商品で使用中のため削除できません`, true);
          return;
        }
        await load();
        showToast(`${label}を削除しました`);
      }
    });
  });

  return { load, get items() { return state.items; } };
}

const categoryController = createMasterController({
  table: "categories",
  label: "カテゴリ",
  listElIds: ["category-list", "category-list-master"],
  addFormElIds: [
    { formId: "category-add-form", inputId: "category-new-name" },
    { formId: "category-add-form-master", inputId: "category-new-name-master" },
  ],
  selectEls: [
    { el: fieldCategory, placeholder: "未分類", isFilter: false },
    { el: categoryFilter, placeholder: "全カテゴリ", isFilter: true },
  ],
  onChange: () => { categories = categoryController.items; renderProducts(); },
});

const brandController = createMasterController({
  table: "brands",
  label: "ブランド",
  listElIds: ["brand-list", "brand-list-master"],
  addFormElIds: [
    { formId: "brand-add-form", inputId: "brand-new-name" },
    { formId: "brand-add-form-master", inputId: "brand-new-name-master" },
  ],
  selectEls: [
    { el: fieldBrand, placeholder: "未設定", isFilter: false },
    { el: brandFilter, placeholder: "全ブランド", isFilter: true },
  ],
  onChange: () => { brands = brandController.items; renderProducts(); },
});

async function loadCategories() {
  await categoryController.load();
}
async function loadBrands() {
  await brandController.load();
}

manageCategoriesBtn.addEventListener("click", () => categoryDialog.showModal());
closeCategoryDialogBtn.addEventListener("click", () => categoryDialog.close());
manageBrandsBtn.addEventListener("click", () => brandDialog.showModal());
closeBrandDialogBtn.addEventListener("click", () => brandDialog.close());

// --- 税抜/税込 計算ヘルパー(products.js から invoices.js でも共用) ---
function toExclTax(price, includesTax, rate) {
  if (price === null || price === undefined) return null;
  return includesTax ? Number(price) / (1 + Number(rate)) : Number(price);
}
function toInclTax(price, includesTax, rate) {
  if (price === null || price === undefined) return null;
  return includesTax ? Number(price) : Number(price) * (1 + Number(rate));
}

function formatPriceCell(p) {
  if (p.price === null || p.price === undefined) return "-";
  const excl = toExclTax(p.price, p.price_includes_tax, p.tax_rate);
  const incl = toInclTax(p.price, p.price_includes_tax, p.tax_rate);
  const primaryLabel = p.price_includes_tax ? "税込" : "税抜";
  const secondaryLabel = p.price_includes_tax ? "税抜" : "税込";
  const secondaryValue = p.price_includes_tax ? excl : incl;
  return `${formatYen(p.price)}(${primaryLabel})<br><span class="price-sub">${formatYen(secondaryValue)}(${secondaryLabel})</span>`;
}

function renderProducts() {
  const term = searchTerm.trim().toLowerCase();
  const filtered = products.filter((p) => {
    if (categoryFilterId && p.category_id !== categoryFilterId) return false;
    if (brandFilterId && p.brand_id !== brandFilterId) return false;
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
    tbody.innerHTML = `<tr class="empty-row"><td colspan="8">${
      products.length === 0 ? "商品がまだありません" : "該当する商品がありません"
    }</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered
    .map((p) => {
      const isLow = p.low_stock_threshold > 0 && p.quantity <= p.low_stock_threshold;
      const categoryName = categories.find((c) => c.id === p.category_id)?.name || "-";
      const brandName = brands.find((b) => b.id === p.brand_id)?.name || "-";
      return `
        <tr class="${isLow ? "low-stock" : ""}" data-id="${p.id}">
          <td>${escapeHtml(p.name)}</td>
          <td>${escapeHtml(p.sku || "-")}</td>
          <td>${escapeHtml(brandName)}</td>
          <td>${escapeHtml(categoryName)}</td>
          <td><span class="qty-badge ${isLow ? "low" : ""}">${p.quantity} ${escapeHtml(p.unit || "")}</span></td>
          <td>${formatPriceCell(p)}</td>
          <td>${escapeHtml(p.purchased_at || "-")}</td>
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

function updatePricePreview() {
  const price = Number(fieldPrice.value);
  if (!fieldPrice.value || Number.isNaN(price)) {
    fieldPricePreview.textContent = "";
    return;
  }
  const includesTax = fieldPriceIncludesTax.value === "true";
  const rate = Number(fieldTaxRate.value);
  const excl = toExclTax(price, includesTax, rate);
  const incl = toInclTax(price, includesTax, rate);
  fieldPricePreview.textContent = `税抜 ${formatYen(excl)} / 税込 ${formatYen(incl)}`;
}
[fieldPrice, fieldPriceIncludesTax, fieldTaxRate].forEach((el) =>
  el.addEventListener("input", updatePricePreview)
);

function openProductDialog(product = null) {
  productForm.reset();
  document.getElementById("field-unit").value = "個";
  document.getElementById("field-quantity").value = 0;
  document.getElementById("field-low-threshold").value = 0;
  fieldPriceIncludesTax.value = "false";
  fieldTaxRate.value = "0.10";

  if (product) {
    productDialogTitle.textContent = "商品を編集";
    document.getElementById("product-id").value = product.id;
    document.getElementById("field-name").value = product.name;
    document.getElementById("field-sku").value = product.sku || "";
    fieldBrand.value = product.brand_id || "";
    fieldCategory.value = product.category_id || "";
    document.getElementById("field-quantity").value = product.quantity;
    document.getElementById("field-unit").value = product.unit || "個";
    document.getElementById("field-low-threshold").value = product.low_stock_threshold;
    fieldPrice.value = product.price ?? "";
    fieldPriceIncludesTax.value = String(!!product.price_includes_tax);
    setSelectByNumericValue(fieldTaxRate, product.tax_rate ?? 0.10, "0.10");
    document.getElementById("field-purchased-at").value = product.purchased_at || "";
    document.getElementById("field-notes").value = product.notes || "";
    deleteProductBtn.hidden = false;
  } else {
    productDialogTitle.textContent = "商品を追加";
    document.getElementById("product-id").value = "";
    fieldCategory.value = "";
    fieldBrand.value = "";
    deleteProductBtn.hidden = true;
  }
  updatePricePreview();
  productDialog.showModal();
}

document.getElementById("add-product-btn").addEventListener("click", () => openProductDialog());
document.getElementById("cancel-dialog-btn").addEventListener("click", () => productDialog.close());

productForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const id = document.getElementById("product-id").value;
  const payload = {
    name: document.getElementById("field-name").value.trim(),
    sku: document.getElementById("field-sku").value.trim() || null,
    brand_id: fieldBrand.value || null,
    category_id: fieldCategory.value || null,
    quantity: Number(document.getElementById("field-quantity").value) || 0,
    unit: document.getElementById("field-unit").value.trim() || "個",
    low_stock_threshold: Number(document.getElementById("field-low-threshold").value) || 0,
    price: fieldPrice.value === "" ? null : Number(fieldPrice.value),
    price_includes_tax: fieldPriceIncludesTax.value === "true",
    tax_rate: Number(fieldTaxRate.value),
    purchased_at: document.getElementById("field-purchased-at").value || null,
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
  productDialog.close();
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

movementForm.addEventListener("submit", async (e) => {
  e.preventDefault();
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
  movementDialog.close();
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
categoryFilter.addEventListener("change", (e) => {
  categoryFilterId = e.target.value;
  renderProducts();
});
brandFilter.addEventListener("change", (e) => {
  brandFilterId = e.target.value;
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

async function initInventoryTab() {
  await Promise.all([loadCategories(), loadBrands()]);
  await loadProducts();
}

initInventoryTab();
