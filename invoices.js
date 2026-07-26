const invoicesTbody = document.getElementById("invoices-tbody");
const addInvoiceBtn = document.getElementById("add-invoice-btn");

const invoiceDialog = document.getElementById("invoice-dialog");
const invoiceDialogTitle = document.getElementById("invoice-dialog-title");
const invoiceForm = document.getElementById("invoice-form");
const invoiceFieldCustomer = document.getElementById("invoice-field-customer");
const invoiceFieldIssueDate = document.getElementById("invoice-field-issue-date");
const invoiceFieldDueDate = document.getElementById("invoice-field-due-date");
const invoiceFieldDiscount = document.getElementById("invoice-field-discount");
const invoiceFieldNotes = document.getElementById("invoice-field-notes");
const invoiceItemsTbody = document.getElementById("invoice-items-tbody");
const addInvoiceItemBtn = document.getElementById("add-invoice-item-btn");
const cancelInvoiceDialogBtn = document.getElementById("cancel-invoice-dialog-btn");
const invoiceSubtotalEl = document.getElementById("invoice-subtotal");
const invoiceTaxEl = document.getElementById("invoice-tax");
const invoiceTotalEl = document.getElementById("invoice-total");
const invoiceTaxBreakdownEl = document.getElementById("invoice-tax-breakdown");

const companySettingsBtn = document.getElementById("company-settings-btn");
const companySettingsDialog = document.getElementById("company-settings-dialog");
const companySettingsForm = document.getElementById("company-settings-form");
const cancelCompanyDialogBtn = document.getElementById("cancel-company-dialog-btn");

const invoicePrintView = document.getElementById("invoice-print-view");
const invoicePreviewView = document.getElementById("invoice-preview-view");

let invoices = [];
let invoicesLoaded = false;
let companySettings = null;

// --- 税率ごとに一括で消費税を計算(行ごとには計算しない) ---
// 税率区分ごとの税抜合計に対して1回だけ端数処理する(インボイス制度の計算方法)。
// 値引きは税率区分ごとの税抜金額の比率で按分してから税額計算する。
function computeInvoiceTotals(items, discountInput = 0) {
  const groups = new Map();
  for (const it of items) {
    const rate = Number(it.tax_rate);
    const lineExcl = Number(it.quantity) * Number(it.unit_price);
    groups.set(rate, (groups.get(rate) || 0) + lineExcl);
  }
  const rawSubtotal = [...groups.values()].reduce((sum, v) => sum + v, 0);
  const discount = Math.max(0, Math.min(Number(discountInput) || 0, rawSubtotal));

  let subtotalExcl = 0;
  let totalTax = 0;
  const breakdown = [...groups.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([rate, rawAmount]) => {
      const share = rawSubtotal > 0 ? rawAmount / rawSubtotal : 0;
      const taxableAmount = rawAmount - discount * share;
      const tax = Math.floor(taxableAmount * rate);
      subtotalExcl += taxableAmount;
      totalTax += tax;
      return { rate, taxableAmount, tax };
    });
  return { breakdown, subtotalExcl, totalTax, grandTotal: subtotalExcl + totalTax, discount, rawSubtotal };
}

// --- 請求書一覧 ---

function renderInvoices() {
  if (invoices.length === 0) {
    invoicesTbody.innerHTML = `<tr class="empty-row"><td colspan="6">請求書がまだありません</td></tr>`;
    return;
  }
  invoicesTbody.innerHTML = invoices
    .map((inv) => {
      const totals = computeInvoiceTotals(inv.invoice_items || [], inv.discount_amount || 0);
      const customerName = inv.customer?.name || "-";
      const editable = inv.status === "issued" || inv.status === "paid";
      return `
        <tr data-id="${inv.id}">
          <td>${escapeHtml(inv.invoice_number)}</td>
          <td>${escapeHtml(customerName)}</td>
          <td>${escapeHtml(inv.issue_date)}</td>
          <td>${formatYen(totals.grandTotal)}</td>
          <td><span class="status-badge ${inv.status}">${statusLabel(inv.status)}</span></td>
          <td>
            <div class="row-actions">
              <button class="btn btn-sm invoice-print-btn" data-id="${inv.id}">🖨 印刷</button>
              ${editable ? `<button class="btn btn-sm invoice-edit-btn" data-id="${inv.id}">修正</button>` : ""}
              ${inv.status === "issued" ? `<button class="btn btn-sm btn-danger invoice-cancel-btn" data-id="${inv.id}">取消</button>` : ""}
              ${inv.status === "issued" ? `<button class="btn btn-sm invoice-paid-btn" data-id="${inv.id}">入金済みに</button>` : ""}
            </div>
          </td>
        </tr>`;
    })
    .join("");
}

function statusLabel(status) {
  return { draft: "下書き", issued: "発行済み", paid: "入金済み", cancelled: "取消済み" }[status] || status;
}

async function loadInvoices() {
  const { data, error } = await supabaseClient
    .from("invoices")
    .select("*, customer:customers(name), invoice_items(quantity, unit_price, tax_rate)")
    .order("created_at", { ascending: false });
  if (error) {
    showToast(`請求書読み込みエラー: ${error.message}`, true);
    return;
  }
  invoices = data;
  invoicesLoaded = true;
  renderInvoices();
}

invoicesTbody.addEventListener("click", async (e) => {
  const printBtn = e.target.closest(".invoice-print-btn");
  const editBtn = e.target.closest(".invoice-edit-btn");
  const cancelBtn = e.target.closest(".invoice-cancel-btn");
  const paidBtn = e.target.closest(".invoice-paid-btn");

  if (printBtn) {
    const invoice = invoices.find((i) => i.id === printBtn.dataset.id);
    if (invoice) await openInvoicePrintView(invoice);
  } else if (editBtn) {
    const invoice = invoices.find((i) => i.id === editBtn.dataset.id);
    if (invoice) await openInvoiceDialog(invoice);
  } else if (cancelBtn) {
    if (!confirm("この請求書を取消しますか?出庫済みの在庫は元に戻ります。")) return;
    const { error } = await supabaseClient.rpc("cancel_invoice", { p_invoice_id: cancelBtn.dataset.id });
    if (error) {
      showToast(`取消エラー: ${error.message}`, true);
      return;
    }
    showToast("請求書を取消し、在庫を戻しました");
    await loadInvoices();
    await loadProducts();
  } else if (paidBtn) {
    const { error } = await supabaseClient.from("invoices").update({ status: "paid" }).eq("id", paidBtn.dataset.id);
    if (error) {
      showToast(`更新エラー: ${error.message}`, true);
      return;
    }
    showToast("入金済みにしました");
    await loadInvoices();
  }
});

// --- 請求書作成・編集ダイアログ ---

function refreshInvoiceCustomerOptions() {
  const current = invoiceFieldCustomer.value;
  invoiceFieldCustomer.innerHTML = customers
    .map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`)
    .join("");
  if (current) invoiceFieldCustomer.value = current;
}

function productOptionsHtml(selectedId) {
  return (
    `<option value="">選択してください</option>` +
    products
      .map((p) => `<option value="${p.id}" ${p.id === selectedId ? "selected" : ""}>${escapeHtml(p.name)}(在庫:${p.quantity})</option>`)
      .join("")
  );
}

function addInvoiceItemRow(prefill = null) {
  const tr = document.createElement("tr");
  const selectedId = prefill?.product_id || "";
  tr.innerHTML = `
    <td><select class="item-product">${productOptionsHtml(selectedId)}</select></td>
    <td><input class="item-quantity" type="number" min="1" step="1" value="${prefill?.quantity ?? 1}" /></td>
    <td><input class="item-unit-price" type="number" step="1" inputmode="numeric" placeholder="0" value="${prefill?.unit_price ?? ""}" /></td>
    <td>
      <select class="item-tax-rate">
        <option value="0.10" selected>10%</option>
        <option value="0.08">8%</option>
        <option value="0">0%</option>
      </select>
    </td>
    <td class="item-subtotal">¥0</td>
    <td><button type="button" class="btn btn-sm btn-danger remove-item-btn">削除</button></td>
  `;
  invoiceItemsTbody.appendChild(tr);
  if (prefill) {
    setSelectByNumericValue(tr.querySelector(".item-tax-rate"), prefill.tax_rate ?? 0.10, "0.10");
  }
}

invoiceItemsTbody.addEventListener("change", (e) => {
  if (e.target.classList.contains("item-product")) {
    const tr = e.target.closest("tr");
    const product = products.find((p) => p.id === e.target.value);
    if (product) {
      const excl = toExclTax(product.price, product.price_includes_tax, product.tax_rate);
      tr.querySelector(".item-unit-price").value = excl !== null ? Math.round(excl) : "";
      setSelectByNumericValue(tr.querySelector(".item-tax-rate"), product.tax_rate ?? 0.10, "0.10");
    }
  }
  recalcInvoiceTotals();
});
invoiceItemsTbody.addEventListener("input", recalcInvoiceTotals);
invoiceFieldDiscount.addEventListener("input", recalcInvoiceTotals);

invoiceItemsTbody.addEventListener("click", (e) => {
  const btn = e.target.closest(".remove-item-btn");
  if (!btn) return;
  btn.closest("tr").remove();
  recalcInvoiceTotals();
});

function readInvoiceItemsFromDom() {
  return [...invoiceItemsTbody.querySelectorAll("tr")].map((tr) => ({
    product_id: tr.querySelector(".item-product").value,
    product: products.find((p) => p.id === tr.querySelector(".item-product").value),
    quantity: Number(tr.querySelector(".item-quantity").value) || 0,
    unit_price: Number(tr.querySelector(".item-unit-price").value) || 0,
    tax_rate: Number(tr.querySelector(".item-tax-rate").value),
  }));
}

function recalcInvoiceTotals() {
  const items = readInvoiceItemsFromDom();

  [...invoiceItemsTbody.querySelectorAll("tr")].forEach((tr, idx) => {
    const item = items[idx];
    tr.querySelector(".item-subtotal").textContent = formatYen(item.quantity * item.unit_price);
  });

  const totals = computeInvoiceTotals(items.filter((i) => i.product_id), invoiceFieldDiscount.value);
  invoiceSubtotalEl.textContent = formatYen(totals.subtotalExcl);
  invoiceTaxEl.textContent = formatYen(totals.totalTax);
  invoiceTotalEl.textContent = formatYen(totals.grandTotal);

  invoiceTaxBreakdownEl.innerHTML = totals.breakdown
    .map(
      (b) =>
        `<div>${formatPercent(b.rate)}対象 税抜${formatYen(b.taxableAmount)} / 消費税${formatYen(b.tax)}</div>`
    )
    .join("");
}

async function openInvoiceDialog(invoice = null) {
  if (!customersLoaded) await loadCustomers();
  refreshInvoiceCustomerOptions();
  invoiceForm.reset();
  invoiceItemsTbody.innerHTML = "";

  if (invoice) {
    invoiceDialogTitle.textContent = `請求書を修正(${invoice.invoice_number})`;
    document.getElementById("invoice-id").value = invoice.id;
    invoiceFieldCustomer.value = invoice.customer_id || "";
    invoiceFieldIssueDate.value = invoice.issue_date;
    invoiceFieldDueDate.value = invoice.due_date || "";
    invoiceFieldDiscount.value = invoice.discount_amount || 0;
    invoiceFieldNotes.value = invoice.notes || "";

    const { data: items, error } = await supabaseClient
      .from("invoice_items")
      .select("*")
      .eq("invoice_id", invoice.id)
      .order("sort_order");
    if (error) {
      showToast(`明細読み込みエラー: ${error.message}`, true);
      return;
    }
    if (items.length === 0) {
      addInvoiceItemRow();
    } else {
      items.forEach((item) => addInvoiceItemRow(item));
    }
  } else {
    invoiceDialogTitle.textContent = "請求書を作成(出荷登録)";
    document.getElementById("invoice-id").value = "";
    invoiceFieldIssueDate.value = todayStr();
    invoiceFieldDueDate.value = "";
    invoiceFieldDiscount.value = 0;
    addInvoiceItemRow();
  }

  recalcInvoiceTotals();
  invoiceDialog.showModal();
}

addInvoiceBtn.addEventListener("click", () => openInvoiceDialog());
addInvoiceItemBtn.addEventListener("click", () => {
  addInvoiceItemRow();
  recalcInvoiceTotals();
});
cancelInvoiceDialogBtn.addEventListener("click", () => invoiceDialog.close());

// --- 発行前プレビュー ---

function customerNameById(id) {
  return customers.find((c) => c.id === id)?.name || "";
}

function buildInvoicePreviewHtml({ isEdit, invoiceNumberLabel, customerName, issueDate, dueDate, notes, items, totals }) {
  return `
    <div class="print-actions">
      <button type="button" class="btn" id="invoice-preview-back-btn">✏️ 内容を修正する</button>
      <button type="button" class="btn btn-primary" id="invoice-preview-confirm-btn">${isEdit ? "この内容で修正を確定する" : "この内容で発行し、出庫を確定する"}</button>
    </div>
    <div class="print-header">
      <div>
        <h2>請求書プレビュー</h2>
        <p>${escapeHtml(invoiceNumberLabel)}</p>
        <p>発行日: ${escapeHtml(issueDate)}${dueDate ? ` / 支払期限: ${escapeHtml(dueDate)}` : ""}</p>
      </div>
    </div>
    <p><strong>${escapeHtml(customerName)}</strong> 様</p>
    <table>
      <thead><tr><th>商品名</th><th>数量</th><th>単価(税抜)</th><th>税率区分</th><th>小計(税抜)</th></tr></thead>
      <tbody>
        ${items
          .map(
            (it) => `
          <tr>
            <td>${escapeHtml(it.product?.name || "(不明な商品)")}</td>
            <td>${it.quantity} ${escapeHtml(it.product?.unit || "")}</td>
            <td>${formatYen(it.unit_price)}</td>
            <td>${formatPercent(it.tax_rate)}</td>
            <td>${formatYen(it.quantity * it.unit_price)}</td>
          </tr>`
          )
          .join("")}
      </tbody>
    </table>
    <table class="print-tax-summary">
      <thead><tr><th>税率区分</th><th>税抜金額</th><th>消費税額</th></tr></thead>
      <tbody>
        ${totals.breakdown
          .map((b) => `<tr><td>${formatPercent(b.rate)}対象</td><td>${formatYen(b.taxableAmount)}</td><td>${formatYen(b.tax)}</td></tr>`)
          .join("")}
      </tbody>
    </table>
    ${totals.discount > 0 ? `<p>値引き(税抜): -${formatYen(totals.discount)}</p>` : ""}
    <p>税抜合計(値引き後): ${formatYen(totals.subtotalExcl)} / 消費税合計: ${formatYen(totals.totalTax)}</p>
    <p style="font-size:1.2rem;"><strong>ご請求金額(税込合計): ${formatYen(totals.grandTotal)}</strong></p>
    ${notes ? `<p>【備考】<br>${escapeHtml(notes).replace(/\n/g, "<br>")}</p>` : ""}
  `;
}

invoiceForm.addEventListener("submit", (e) => {
  e.preventDefault();
  if (!invoiceFieldCustomer.value) {
    showToast("販売先を選択してください", true);
    return;
  }
  const items = readInvoiceItemsFromDom().filter((i) => i.product_id);
  if (items.length === 0) {
    showToast("明細を1件以上入力してください", true);
    return;
  }
  for (const item of items) {
    if (item.quantity <= 0) {
      showToast("数量は1以上で入力してください", true);
      return;
    }
  }

  const invoiceId = document.getElementById("invoice-id").value || null;
  const isEdit = !!invoiceId;
  const existingInvoice = isEdit ? invoices.find((i) => i.id === invoiceId) : null;
  const discount = Number(invoiceFieldDiscount.value) || 0;
  const totals = computeInvoiceTotals(items, discount);

  const pendingSubmit = {
    invoiceId,
    isEdit,
    customerId: invoiceFieldCustomer.value,
    issueDate: invoiceFieldIssueDate.value || null,
    dueDate: invoiceFieldDueDate.value || null,
    notes: invoiceFieldNotes.value.trim() || null,
    discount,
    items,
  };

  const html = buildInvoicePreviewHtml({
    isEdit,
    invoiceNumberLabel: isEdit ? `請求書番号: ${existingInvoice?.invoice_number || ""}` : "請求書番号: (発行時に自動採番されます)",
    customerName: customerNameById(pendingSubmit.customerId),
    issueDate: pendingSubmit.issueDate,
    dueDate: pendingSubmit.dueDate,
    notes: pendingSubmit.notes,
    items,
    totals,
  });

  // <dialog> はブラウザのトップレイヤーに描画されるため、開いたままではプレビューの
  // <div> がクリックを受け取れない。プレビュー表示中は一旦ダイアログを閉じる。
  invoiceDialog.close();
  invoicePreviewView.innerHTML = html;
  invoicePreviewView.hidden = false;

  document.getElementById("invoice-preview-back-btn").addEventListener("click", () => {
    invoicePreviewView.hidden = true;
    invoicePreviewView.innerHTML = "";
    invoiceDialog.showModal();
  });
  document.getElementById("invoice-preview-confirm-btn").addEventListener("click", () => confirmInvoiceSubmit(pendingSubmit));
});

async function confirmInvoiceSubmit(pending) {
  const rpcName = pending.isEdit ? "update_invoice" : "create_invoice";
  const params = pending.isEdit
    ? {
        p_invoice_id: pending.invoiceId,
        p_customer_id: pending.customerId,
        p_issue_date: pending.issueDate,
        p_due_date: pending.dueDate,
        p_notes: pending.notes,
        p_items: pending.items.map((i, idx) => ({
          product_id: i.product_id,
          quantity: i.quantity,
          unit_price: i.unit_price,
          tax_rate: i.tax_rate,
          sort_order: idx,
        })),
        p_discount_amount: pending.discount,
      }
    : {
        p_customer_id: pending.customerId,
        p_issue_date: pending.issueDate,
        p_due_date: pending.dueDate,
        p_notes: pending.notes,
        p_items: pending.items.map((i, idx) => ({
          product_id: i.product_id,
          quantity: i.quantity,
          unit_price: i.unit_price,
          tax_rate: i.tax_rate,
          sort_order: idx,
        })),
        p_discount_amount: pending.discount,
      };

  const { data, error } = await supabaseClient.rpc(rpcName, params);

  invoicePreviewView.hidden = true;
  invoicePreviewView.innerHTML = "";

  if (error) {
    showToast(`${pending.isEdit ? "修正" : "発行"}エラー: ${error.message}`, true);
    return;
  }

  showToast(
    pending.isEdit
      ? `請求書 ${data.invoice_number} を修正し、在庫を再調整しました`
      : `請求書 ${data.invoice_number} を発行し、出庫を確定しました`
  );
  invoiceDialog.close();
  await Promise.all([loadInvoices(), loadProducts()]);
}

// --- 発行者(自社)情報 ---

async function loadCompanySettings() {
  const { data, error } = await supabaseClient.from("company_settings").select("*").eq("id", 1).maybeSingle();
  if (error) {
    showToast(`発行者情報読み込みエラー: ${error.message}`, true);
    return null;
  }
  companySettings = data;
  return data;
}

companySettingsBtn.addEventListener("click", async () => {
  const s = companySettings || (await loadCompanySettings()) || {};
  document.getElementById("company-field-name").value = s.company_name || "";
  document.getElementById("company-field-postal").value = s.postal_code || "";
  document.getElementById("company-field-phone").value = s.phone || "";
  document.getElementById("company-field-address").value = s.address || "";
  document.getElementById("company-field-invoice-number").value = s.invoice_registration_number || "";
  document.getElementById("company-field-bank").value = s.bank_info || "";
  companySettingsDialog.showModal();
});
cancelCompanyDialogBtn.addEventListener("click", () => companySettingsDialog.close());

companySettingsForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const payload = {
    id: 1,
    company_name: document.getElementById("company-field-name").value.trim() || null,
    postal_code: document.getElementById("company-field-postal").value.trim() || null,
    phone: document.getElementById("company-field-phone").value.trim() || null,
    address: document.getElementById("company-field-address").value.trim() || null,
    invoice_registration_number: document.getElementById("company-field-invoice-number").value.trim() || null,
    bank_info: document.getElementById("company-field-bank").value.trim() || null,
  };
  const { error } = await supabaseClient.from("company_settings").upsert(payload);
  if (error) {
    showToast(`保存エラー: ${error.message}`, true);
    return;
  }
  companySettings = payload;
  showToast("発行者情報を保存しました");
  companySettingsDialog.close();
});

// --- 請求書 印刷ビュー(発行済みの請求書を表示) ---

async function openInvoicePrintView(invoice) {
  const { data: fullInvoice, error } = await supabaseClient
    .from("invoices")
    .select("*, customer:customers(*), invoice_items(*)")
    .eq("id", invoice.id)
    .single();
  if (error) {
    showToast(`読み込みエラー: ${error.message}`, true);
    return;
  }
  if (!companySettings) await loadCompanySettings();
  const s = companySettings || {};

  const items = [...fullInvoice.invoice_items].sort((a, b) => a.sort_order - b.sort_order);
  const totals = computeInvoiceTotals(items, fullInvoice.discount_amount || 0);

  invoicePrintView.innerHTML = `
    <div class="print-actions">
      <button type="button" class="btn btn-primary" id="print-now-btn">🖨 印刷 / PDF保存</button>
      <button type="button" class="btn" id="close-print-btn">閉じる</button>
    </div>
    <div class="print-header">
      <div>
        <h2>請求書</h2>
        <p>請求書番号: ${escapeHtml(fullInvoice.invoice_number)}</p>
        <p>発行日: ${escapeHtml(fullInvoice.issue_date)}${fullInvoice.due_date ? ` / 支払期限: ${escapeHtml(fullInvoice.due_date)}` : ""}</p>
      </div>
      <div>
        <p><strong>${escapeHtml(s.company_name || "")}</strong></p>
        <p>${escapeHtml(s.postal_code || "")} ${escapeHtml(s.address || "")}</p>
        <p>${escapeHtml(s.phone || "")}</p>
        ${s.invoice_registration_number ? `<p>登録番号: ${escapeHtml(s.invoice_registration_number)}</p>` : ""}
      </div>
    </div>

    <p><strong>${escapeHtml(fullInvoice.customer?.name || "")}</strong> 様</p>

    <table>
      <thead>
        <tr><th>商品名</th><th>数量</th><th>単価(税抜)</th><th>税率</th><th>金額(税抜)</th></tr>
      </thead>
      <tbody>
        ${items
          .map(
            (it) => `
          <tr>
            <td>${escapeHtml(it.product_name)}</td>
            <td>${it.quantity} ${escapeHtml(it.unit || "")}</td>
            <td>${formatYen(it.unit_price)}</td>
            <td>${formatPercent(it.tax_rate)}</td>
            <td>${formatYen(it.quantity * it.unit_price)}</td>
          </tr>`
          )
          .join("")}
      </tbody>
    </table>

    <table class="print-tax-summary">
      <thead><tr><th>税率区分</th><th>税抜金額</th><th>消費税額</th></tr></thead>
      <tbody>
        ${totals.breakdown
          .map(
            (b) => `<tr><td>${formatPercent(b.rate)}対象</td><td>${formatYen(b.taxableAmount)}</td><td>${formatYen(b.tax)}</td></tr>`
          )
          .join("")}
        <tr><th>合計</th><th>${formatYen(totals.subtotalExcl)}</th><th>${formatYen(totals.totalTax)}</th></tr>
      </tbody>
    </table>

    ${totals.discount > 0 ? `<p>値引き(税抜): -${formatYen(totals.discount)}</p>` : ""}
    <p style="font-size:1.2rem;"><strong>ご請求金額(税込合計): ${formatYen(totals.grandTotal)}</strong></p>

    ${s.bank_info ? `<p>【お振込先】<br>${escapeHtml(s.bank_info).replace(/\n/g, "<br>")}</p>` : ""}
    ${fullInvoice.notes ? `<p>【備考】<br>${escapeHtml(fullInvoice.notes).replace(/\n/g, "<br>")}</p>` : ""}
  `;

  invoicePrintView.hidden = false;
  document.getElementById("print-now-btn").addEventListener("click", () => window.print());
  document.getElementById("close-print-btn").addEventListener("click", () => {
    invoicePrintView.hidden = true;
    invoicePrintView.innerHTML = "";
  });
}

document.addEventListener("tab-activated", (e) => {
  if (e.detail.tab === "invoices" && !invoicesLoaded) {
    loadInvoices();
  }
});
