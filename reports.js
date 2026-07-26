const reportMonthInput = document.getElementById("report-month");
const exportReportBtn = document.getElementById("export-report-btn");
const exportReportPdfBtn = document.getElementById("export-report-pdf-btn");

const salesFromDateInput = document.getElementById("sales-from-date");
const salesToDateInput = document.getElementById("sales-to-date");
const salesRunBtn = document.getElementById("sales-run-btn");
const salesResultsWrap = document.getElementById("sales-results-wrap");
const salesSummaryEl = document.getElementById("sales-summary");
const salesByProductTbody = document.getElementById("sales-by-product-tbody");
const salesByCustomerTbody = document.getElementById("sales-by-customer-tbody");
const salesExportCsvBtn = document.getElementById("sales-export-csv-btn");
const salesExportPdfBtn = document.getElementById("sales-export-pdf-btn");

const reportPrintView = document.getElementById("report-print-view");

function csvEscape(value) {
  const str = String(value ?? "");
  if (/[",\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function downloadCsv(filename, header, rows) {
  const csvLines = [header, ...rows].map((row) => row.map(csvEscape).join(","));
  const csvContent = "﻿" + csvLines.join("\r\n");
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function showReportPrintView(html) {
  reportPrintView.innerHTML = html;
  reportPrintView.hidden = false;
  document.getElementById("report-print-now-btn").addEventListener("click", () => window.print());
  document.getElementById("report-print-close-btn").addEventListener("click", () => {
    reportPrintView.hidden = true;
    reportPrintView.innerHTML = "";
  });
}

function printActionsHtml() {
  return `
    <div class="print-actions">
      <button type="button" class="btn btn-primary" id="report-print-now-btn">🖨 印刷 / PDF保存</button>
      <button type="button" class="btn" id="report-print-close-btn">閉じる</button>
    </div>`;
}

// --- 月末在庫表 ---

function monthEndCutoffIso(yearMonthValue) {
  const [y, m] = yearMonthValue.split("-").map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  const dd = String(lastDay).padStart(2, "0");
  const mm = String(m).padStart(2, "0");
  // 日本時間の月末23:59:59.999を基準にする
  return { cutoff: `${y}-${mm}-${dd}T23:59:59.999+09:00`, label: `${y}-${mm}` };
}

async function computeMonthEndInventory() {
  if (!reportMonthInput.value) {
    showToast("対象年月を選択してください", true);
    return null;
  }
  const { cutoff, label } = monthEndCutoffIso(reportMonthInput.value);

  const { data: laterMovements, error } = await supabaseClient
    .from("stock_movements")
    .select("product_id, quantity_change")
    .gt("created_at", cutoff);

  if (error) {
    showToast(`集計エラー: ${error.message}`, true);
    return null;
  }

  const laterSumByProduct = new Map();
  for (const m of laterMovements) {
    laterSumByProduct.set(m.product_id, (laterSumByProduct.get(m.product_id) || 0) + m.quantity_change);
  }

  const categoryNameById = new Map(categories.map((c) => [c.id, c.name]));

  const rows = products.map((p) => {
    const qtyAtMonthEnd = p.quantity - (laterSumByProduct.get(p.id) || 0);
    const priceExcl = toExclTax(p.price, p.price_includes_tax, p.tax_rate);
    const amount = priceExcl !== null ? Math.round(priceExcl * qtyAtMonthEnd) : null;
    return {
      name: p.name,
      sku: p.sku || "",
      category: categoryNameById.get(p.category_id) || "",
      quantity: qtyAtMonthEnd,
      unit: p.unit || "",
      priceExcl: priceExcl !== null ? Math.round(priceExcl) : null,
      amount,
    };
  });

  return { label, rows };
}

async function exportMonthEndInventoryCsv() {
  const result = await computeMonthEndInventory();
  if (!result) return;
  const header = ["商品名", "SKU", "カテゴリ", "数量(月末時点)", "単位", "単価(税抜)", "金額(税抜)"];
  const rows = result.rows.map((r) => [r.name, r.sku, r.category, r.quantity, r.unit, r.priceExcl ?? "", r.amount ?? ""]);
  downloadCsv(`inventory_${result.label}.csv`, header, rows);
  showToast(`${result.label} 時点の在庫表を出力しました`);
}

async function exportMonthEndInventoryPdf() {
  const result = await computeMonthEndInventory();
  if (!result) return;
  const totalAmount = result.rows.reduce((sum, r) => sum + (r.amount || 0), 0);

  const html = `
    ${printActionsHtml()}
    <div class="print-header">
      <div><h2>月末在庫表</h2><p>対象年月: ${escapeHtml(result.label)}</p></div>
    </div>
    <table>
      <thead>
        <tr><th>商品名</th><th>SKU</th><th>カテゴリ</th><th>数量</th><th>単価(税抜)</th><th>金額(税抜)</th></tr>
      </thead>
      <tbody>
        ${result.rows
          .map(
            (r) => `
          <tr>
            <td>${escapeHtml(r.name)}</td>
            <td>${escapeHtml(r.sku)}</td>
            <td>${escapeHtml(r.category)}</td>
            <td>${r.quantity} ${escapeHtml(r.unit)}</td>
            <td>${r.priceExcl !== null ? formatYen(r.priceExcl) : "-"}</td>
            <td>${r.amount !== null ? formatYen(r.amount) : "-"}</td>
          </tr>`
          )
          .join("")}
      </tbody>
    </table>
    <p style="font-size:1.1rem;"><strong>合計金額(税抜): ${formatYen(totalAmount)}</strong></p>
  `;
  showReportPrintView(html);
}

exportReportBtn.addEventListener("click", exportMonthEndInventoryCsv);
exportReportPdfBtn.addEventListener("click", exportMonthEndInventoryPdf);

// --- 販売実績レポート ---

let lastSalesResult = null;

async function computeSalesReport(from, to) {
  const { data, error } = await supabaseClient
    .from("invoices")
    .select("invoice_number, issue_date, status, customer:customers(name), invoice_items(product_name, quantity, unit_price)")
    .neq("status", "cancelled")
    .gte("issue_date", from)
    .lte("issue_date", to);

  if (error) {
    showToast(`集計エラー: ${error.message}`, true);
    return null;
  }

  const byProduct = new Map();
  const byCustomer = new Map();
  let grandTotal = 0;

  for (const inv of data) {
    const customerName = inv.customer?.name || "(未設定)";
    for (const item of inv.invoice_items) {
      const amount = item.quantity * item.unit_price;
      grandTotal += amount;

      const p = byProduct.get(item.product_name) || { quantity: 0, amount: 0 };
      p.quantity += item.quantity;
      p.amount += amount;
      byProduct.set(item.product_name, p);

      const c = byCustomer.get(customerName) || { amount: 0 };
      c.amount += amount;
      byCustomer.set(customerName, c);
    }
  }

  return {
    from,
    to,
    invoiceCount: data.length,
    grandTotal,
    byProduct: [...byProduct.entries()].sort((a, b) => b[1].amount - a[1].amount),
    byCustomer: [...byCustomer.entries()].sort((a, b) => b[1].amount - a[1].amount),
  };
}

function renderSalesResults(result) {
  salesByProductTbody.innerHTML =
    result.byProduct.length === 0
      ? `<tr class="empty-row"><td colspan="3">データがありません</td></tr>`
      : result.byProduct
          .map(([name, v]) => `<tr><td>${escapeHtml(name)}</td><td>${v.quantity}</td><td>${formatYen(v.amount)}</td></tr>`)
          .join("");

  salesByCustomerTbody.innerHTML =
    result.byCustomer.length === 0
      ? `<tr class="empty-row"><td colspan="2">データがありません</td></tr>`
      : result.byCustomer.map(([name, v]) => `<tr><td>${escapeHtml(name)}</td><td>${formatYen(v.amount)}</td></tr>`).join("");

  salesSummaryEl.textContent = `期間: ${result.from} 〜 ${result.to} / 請求件数: ${result.invoiceCount}件 / 売上合計(税抜): ${formatYen(result.grandTotal)}`;
  salesResultsWrap.hidden = false;
}

salesRunBtn.addEventListener("click", async () => {
  const from = salesFromDateInput.value;
  const to = salesToDateInput.value;
  if (!from || !to) {
    showToast("開始日と終了日を指定してください", true);
    return;
  }
  if (from > to) {
    showToast("開始日は終了日より前にしてください", true);
    return;
  }
  const result = await computeSalesReport(from, to);
  if (!result) return;
  lastSalesResult = result;
  renderSalesResults(result);
});

salesExportCsvBtn.addEventListener("click", () => {
  if (!lastSalesResult) return;
  const header1 = ["商品名", "数量", "売上金額(税抜)"];
  const rows1 = lastSalesResult.byProduct.map(([name, v]) => [name, v.quantity, v.amount]);
  downloadCsv(`sales_by_product_${lastSalesResult.from}_${lastSalesResult.to}.csv`, header1, rows1);
});

salesExportPdfBtn.addEventListener("click", () => {
  if (!lastSalesResult) return;
  const r = lastSalesResult;
  const html = `
    ${printActionsHtml()}
    <div class="print-header">
      <div><h2>販売実績レポート</h2><p>期間: ${escapeHtml(r.from)} 〜 ${escapeHtml(r.to)}</p></div>
    </div>
    <p>請求件数: ${r.invoiceCount}件 / 売上合計(税抜): ${formatYen(r.grandTotal)}</p>

    <h3>商品別</h3>
    <table>
      <thead><tr><th>商品名</th><th>数量</th><th>売上金額(税抜)</th></tr></thead>
      <tbody>
        ${r.byProduct.map(([name, v]) => `<tr><td>${escapeHtml(name)}</td><td>${v.quantity}</td><td>${formatYen(v.amount)}</td></tr>`).join("")}
      </tbody>
    </table>

    <h3>取引先別</h3>
    <table>
      <thead><tr><th>取引先</th><th>売上金額(税抜)</th></tr></thead>
      <tbody>
        ${r.byCustomer.map(([name, v]) => `<tr><td>${escapeHtml(name)}</td><td>${formatYen(v.amount)}</td></tr>`).join("")}
      </tbody>
    </table>
  `;
  showReportPrintView(html);
});

document.addEventListener("tab-activated", (e) => {
  if (e.detail.tab !== "reports") return;
  if (!reportMonthInput.value) {
    const now = new Date();
    reportMonthInput.value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  }
  if (!salesFromDateInput.value) {
    const now = new Date();
    const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
    salesFromDateInput.value = firstDay.toISOString().slice(0, 10);
    salesToDateInput.value = todayStr();
  }
});
