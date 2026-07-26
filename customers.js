const customersTbody = document.getElementById("customers-tbody");
const customerSearchInput = document.getElementById("customer-search-input");
const addCustomerBtn = document.getElementById("add-customer-btn");

const customerDialog = document.getElementById("customer-dialog");
const customerForm = document.getElementById("customer-form");
const customerDialogTitle = document.getElementById("customer-dialog-title");
const deleteCustomerBtn = document.getElementById("delete-customer-btn");
const cancelCustomerDialogBtn = document.getElementById("cancel-customer-dialog-btn");

let customers = [];
let customerSearchTerm = "";
let customersLoaded = false;

function renderCustomers() {
  const term = customerSearchTerm.trim().toLowerCase();
  const filtered = customers.filter((c) => !term || c.name.toLowerCase().includes(term));

  if (filtered.length === 0) {
    customersTbody.innerHTML = `<tr class="empty-row"><td colspan="6">${
      customers.length === 0 ? "取引先がまだありません" : "該当する取引先がありません"
    }</td></tr>`;
    return;
  }

  customersTbody.innerHTML = filtered
    .map(
      (c) => `
        <tr data-id="${c.id}">
          <td>${escapeHtml(c.customer_code || "-")}</td>
          <td>${escapeHtml(c.name)}</td>
          <td>${escapeHtml(c.contact_name || "-")}</td>
          <td>${escapeHtml(c.phone || "-")}</td>
          <td>${escapeHtml(c.email || "-")}</td>
          <td>
            <div class="row-actions">
              <button class="btn btn-sm customer-edit-btn" data-id="${c.id}">編集</button>
            </div>
          </td>
        </tr>`
    )
    .join("");
}

async function loadCustomers() {
  const { data, error } = await supabaseClient.from("customers").select("*").order("name");
  if (error) {
    showToast(`取引先読み込みエラー: ${error.message}`, true);
    return;
  }
  customers = data;
  customersLoaded = true;
  renderCustomers();
}

function openCustomerDialog(customer = null) {
  customerForm.reset();
  if (customer) {
    customerDialogTitle.textContent = "取引先を編集";
    document.getElementById("customer-id").value = customer.id;
    document.getElementById("customer-field-code").value = customer.customer_code || "";
    document.getElementById("customer-field-name").value = customer.name;
    document.getElementById("customer-field-contact").value = customer.contact_name || "";
    document.getElementById("customer-field-phone").value = customer.phone || "";
    document.getElementById("customer-field-email").value = customer.email || "";
    document.getElementById("customer-field-address").value = customer.address || "";
    document.getElementById("customer-field-notes").value = customer.notes || "";
    deleteCustomerBtn.hidden = false;
  } else {
    customerDialogTitle.textContent = "取引先を追加";
    document.getElementById("customer-id").value = "";
    deleteCustomerBtn.hidden = true;
  }
  customerDialog.showModal();
}

addCustomerBtn.addEventListener("click", () => openCustomerDialog());
cancelCustomerDialogBtn.addEventListener("click", () => customerDialog.close());

customerForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const id = document.getElementById("customer-id").value;
  const codeInput = document.getElementById("customer-field-code").value.trim();
  const payload = {
    customer_code: codeInput || null,
    name: document.getElementById("customer-field-name").value.trim(),
    contact_name: document.getElementById("customer-field-contact").value.trim() || null,
    phone: document.getElementById("customer-field-phone").value.trim() || null,
    email: document.getElementById("customer-field-email").value.trim() || null,
    address: document.getElementById("customer-field-address").value.trim() || null,
    notes: document.getElementById("customer-field-notes").value.trim() || null,
  };

  if (!payload.name) {
    showToast("取引先名を入力してください", true);
    return;
  }
  if (codeInput && !/^[0-9]{9}$/.test(codeInput)) {
    showToast("取引先コードは9桁の数字で入力してください", true);
    return;
  }

  const query = id
    ? supabaseClient.from("customers").update(payload).eq("id", id)
    : supabaseClient.from("customers").insert(payload);

  const { error } = await query;
  if (error) {
    if (error.code === "23505" && error.message.includes("customers_code_unique")) {
      showToast("この取引先コードは既に他の取引先で使用されています", true);
    } else {
      showToast(`保存エラー: ${error.message}`, true);
    }
    return;
  }
  showToast("保存しました");
  customerDialog.close();
  await loadCustomers();
  if (typeof refreshInvoiceCustomerOptions === "function") refreshInvoiceCustomerOptions();
});

deleteCustomerBtn.addEventListener("click", async () => {
  const id = document.getElementById("customer-id").value;
  if (!id) return;
  if (!confirm("この取引先を削除しますか?")) return;

  const { error } = await supabaseClient.from("customers").delete().eq("id", id);
  if (error) {
    showToast(`削除エラー: ${error.message}(請求書で使用中の可能性があります)`, true);
    return;
  }
  customerDialog.close();
  showToast("削除しました");
  await loadCustomers();
  if (typeof refreshInvoiceCustomerOptions === "function") refreshInvoiceCustomerOptions();
});

customersTbody.addEventListener("click", (e) => {
  const btn = e.target.closest(".customer-edit-btn");
  if (!btn) return;
  const customer = customers.find((c) => c.id === btn.dataset.id);
  if (customer) openCustomerDialog(customer);
});

customerSearchInput.addEventListener("input", (e) => {
  customerSearchTerm = e.target.value;
  renderCustomers();
});

document.addEventListener("tab-activated", (e) => {
  if (e.detail.tab === "customers" && !customersLoaded) {
    loadCustomers();
  }
});
