const invoicesTbody = document.getElementById("invoices-tbody");
const addInvoiceBtn = document.getElementById("add-invoice-btn");

const invoiceDialog = document.getElementById("invoice-dialog");
const invoiceForm = document.getElementById("invoice-form");
const invoiceFieldCustomer = document.getElementById("invoice-field-customer");
const invoiceFieldIssueDate = document.getElementById("invoice-field-issue-date");
const invoiceFieldDueDate = document.getElementById("invoice-field-due-date");
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

let invoices = [];
let invoicesLoaded = false;
let companySettings = null;

// --- 税率ごとに一括で消費税を計算(行ごとには計算しない) ---
// 税率区分ごとの税抜合計に対して1回だけ端数処理する(インボイス制度の計算方法)
function computeInvoiceTotals(items) {
  const groups = new Map();
  for (const it of items) {
    const rate = Number(it.tax_rate);
    const lineExcl = Number(it.quantity) * Number(it.unit_price);
    groups.set(rate, (groups.get(rate) || 0) + lineExcl);
  }
  let subtotalExcl = 0;
  let totalTax = 0;
  const breakdown = [...groups.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([rate, taxableAmount]) => {
      const tax = Math.floor(taxableAmount * rate);
      subtotalExcl += taxableAmount;
      totalTax += tax;
      return { rate, taxableAmount, tax };
    });
  return { breakdown, subtotalExcl, totalTax, grandTotal: subtotalExcl + totalTax };
}

// --- 請求書一覧 ---

function renderInvoices() {
  if (invoices.length === 0) {
    invoicesTbody.innerHTML = `<tr class="empty-row"><td colspan="6">請求書がまだありません</td></tr>`;
    return;
  }
  invoicesTbody.innerHTML = invoices
    .map((inv) => {
      const totals = computeInvoiceTotals(inv.invoice_items || []);
      const customerName = inv.customer?.name || "-";
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
  const cancelBtn = e.target.closest(".invoice-cancel-btn");
  const paidBtn = e.target.closest(".invoice-paid-btn");

  if (printBtn) {
    const invoice = invoices.find((i) => i.id === printBtn.dataset.id);
    if (invoice) await openInvoicePrintView(invoice);
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

// --- 請求書作成ダイアログ ---

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

function addInvoiceItemRow() {
  const tr = document.createElement("tr");
  tr.innerHTML = `
    <td><select class="item-product">${productOptionsHtml("")}</select></td>
    <td><input class="item-quantity" type="number" min="1" step="1" value="1" /></td>
    <td><input class="item-unit-price" type="number" min="0" step="1" value="0" /></td>
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
}

invoiceItemsTbody.addEventListener("change", (e) => {
  if (e.target.classList.contains("item-product")) {
    const tr = e.target.closest("tr");
    const product = products.find((p) => p.id === e.target.value);
    if (product) {
      const excl = toExclTax(product.price, product.price_includes_tax, product.tax_rate) || 0;
      tr.querySelector(".item-unit-price").value = Math.round(excl);
      setSelectByNumericValue(tr.querySelector(".item-tax-rate"), product.tax_rate ?? 0.10, "0.10");
    }
  }
  recalcInvoiceTotals();
});
invoiceItemsTbody.addEventListener("input", recalcInvoiceTotals);

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

  const totals = computeInvoiceTotals(items.filter((i) => i.product_id));
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

async function openInvoiceDialog() {
  if (!customersLoaded) await loadCustomers();
  refreshInvoiceCustomerOptions();
  invoiceForm.reset();
  invoiceFieldIssueDate.value = todayStr();
  invoiceFieldDueDate.value = "";
  invoiceItemsTbody.innerHTML = "";
  addInvoiceItemRow();
  recalcInvoiceTotals();
  invoiceDialog.showModal();
}

addInvoiceBtn.addEventListener("click", openInvoiceDialog);
addInvoiceItemBtn.addEventListener("click", () => {
  addInvoiceItemRow();
  recalcInvoiceTotals();
});
cancelInvoiceDialogBtn.addEventListener("click", () => invoiceDialog.close());

invoiceForm.addEventListener("submit", async (e) => {
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

  const { data, error } = await supabaseClient.rpc("create_invoice", {
    p_customer_id: invoiceFieldCustomer.value,
    p_issue_date: invoiceFieldIssueDate.value || null,
    p_due_date: invoiceFieldDueDate.value || null,
    p_notes: invoiceFieldNotes.value.trim() || null,
    p_items: items.map((i, idx) => ({
      product_id: i.product_id,
      quantity: i.quantity,
      unit_price: i.unit_price,
      tax_rate: i.tax_rate,
      sort_order: idx,
    })),
  });

  if (error) {
    showToast(`発行エラー: ${error.message}`, true);
    return;
  }

  showToast(`請求書 ${data.invoice_number} を発行し、出庫を確定しました`);
  invoiceDialog.close();
  await Promise.all([loadInvoices(), loadProducts()]);
});

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

// --- 請求書 印刷ビュー ---

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
  const totals = computeInvoiceTotals(items);

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
