const reportMonthInput = document.getElementById("report-month");
const exportReportBtn = document.getElementById("export-report-btn");

function csvEscape(value) {
  const str = String(value ?? "");
  if (/[",\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function monthEndCutoffIso(yearMonthValue) {
  const [y, m] = yearMonthValue.split("-").map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  const dd = String(lastDay).padStart(2, "0");
  const mm = String(m).padStart(2, "0");
  // 日本時間の月末23:59:59.999を基準にする
  return { cutoff: `${y}-${mm}-${dd}T23:59:59.999+09:00`, label: `${y}-${mm}` };
}

async function exportMonthEndInventory() {
  if (!reportMonthInput.value) {
    showToast("対象年月を選択してください", true);
    return;
  }
  const { cutoff, label } = monthEndCutoffIso(reportMonthInput.value);

  const { data: laterMovements, error } = await supabaseClient
    .from("stock_movements")
    .select("product_id, quantity_change")
    .gt("created_at", cutoff);

  if (error) {
    showToast(`集計エラー: ${error.message}`, true);
    return;
  }

  const laterSumByProduct = new Map();
  for (const m of laterMovements) {
    laterSumByProduct.set(m.product_id, (laterSumByProduct.get(m.product_id) || 0) + m.quantity_change);
  }

  const categoryNameById = new Map(categories.map((c) => [c.id, c.name]));

  const header = ["商品名", "SKU", "カテゴリ", "数量(月末時点)", "単位", "単価(税抜)", "金額(税抜)"];
  const rows = products.map((p) => {
    const qtyAtMonthEnd = p.quantity - (laterSumByProduct.get(p.id) || 0);
    const priceExcl = toExclTax(p.price, p.price_includes_tax, p.tax_rate);
    const amount = priceExcl !== null ? Math.round(priceExcl * qtyAtMonthEnd) : "";
    return [
      p.name,
      p.sku || "",
      categoryNameById.get(p.category_id) || "",
      qtyAtMonthEnd,
      p.unit || "",
      priceExcl !== null ? Math.round(priceExcl) : "",
      amount,
    ];
  });

  const csvLines = [header, ...rows].map((row) => row.map(csvEscape).join(","));
  const csvContent = "﻿" + csvLines.join("\r\n");

  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `inventory_${label}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  showToast(`${label} 時点の在庫表を出力しました`);
}

exportReportBtn.addEventListener("click", exportMonthEndInventory);

document.addEventListener("tab-activated", (e) => {
  if (e.detail.tab === "reports" && !reportMonthInput.value) {
    const now = new Date();
    reportMonthInput.value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  }
});
