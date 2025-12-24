function normalizeThaiPhone(rawPhone) {
  if (rawPhone === null || typeof rawPhone === "undefined") return null;
  const asString = typeof rawPhone === "string" ? rawPhone : String(rawPhone);
  const digits = asString.replace(/\D/g, "");
  if (!digits) return null;

  if (digits.startsWith("66") && digits.length === 11) {
    const normalized = `0${digits.slice(2)}`;
    return /^0\d{9}$/.test(normalized) ? normalized : null;
  }

  if (digits.startsWith("660") && digits.length === 12) {
    const normalized = `0${digits.slice(3)}`;
    return /^0\d{9}$/.test(normalized) ? normalized : null;
  }

  if (digits.startsWith("0") && digits.length === 10) {
    return /^0\d{9}$/.test(digits) ? digits : null;
  }

  return null;
}

function normalizeThaiPostalCode(rawPostalCode) {
  if (rawPostalCode === null || typeof rawPostalCode === "undefined") return null;
  const asString =
    typeof rawPostalCode === "string" ? rawPostalCode : String(rawPostalCode);
  const digits = asString.replace(/\D/g, "");
  if (!digits) return null;
  if (!/^\d{5}$/.test(digits)) return null;
  return digits;
}

function buildAddressText(draft) {
  if (!draft || typeof draft !== "object") return "";
  const shippingAddress =
    typeof draft.shippingAddress === "string" ? draft.shippingAddress.trim() : "";
  const subDistrict =
    typeof draft.addressSubDistrict === "string"
      ? draft.addressSubDistrict.trim()
      : "";
  const district =
    typeof draft.addressDistrict === "string" ? draft.addressDistrict.trim() : "";
  const province =
    typeof draft.addressProvince === "string" ? draft.addressProvince.trim() : "";
  const postal = normalizeThaiPostalCode(draft.addressPostalCode) || "";

  const parts = [];
  if (shippingAddress) parts.push(shippingAddress);
  if (subDistrict) parts.push(`ต.${subDistrict}`);
  if (district) parts.push(`อ.${district}`);
  if (province) parts.push(`จ.${province}`);
  if (postal) parts.push(postal);

  return parts.join(" ").trim();
}

const DEFAULT_AUDIT_ASK_TEMPLATE = `ขอข้อมูลจัดส่งเพิ่มเติมเพื่อสรุปออเดอร์นะคะ 🙏
{{missing_fields}}

พิมพ์รวมในข้อความเดียวได้เลยค่ะ`;

const DEFAULT_AUDIT_SUMMARY_TEMPLATE = `✅ขอบคุณค่ะ สรุปรายการดังนี้

{{items_lines}}
⭐️ยอดรวม {{total_text}}{{payment_summary}}

ชื่อ: {{customer_name}}
ที่อยู่: {{address_text}}
โทร: {{phone}}

🚚จัดส่งภายใน 2-3 วันทำการค่ะ
หากมีเลขพัสดุจะแจ้งให้ทราบอีกครั้ง ขอบคุณมากค่ะ✅`;

const FIELD_LABELS = Object.freeze({
  customerName: "ชื่อผู้รับ",
  shippingAddress: "ที่อยู่",
  addressSubDistrict: "ตำบล",
  addressDistrict: "อำเภอ",
  addressProvince: "จังหวัด",
  addressPostalCode: "รหัสไปรษณีย์ (5 หลัก)",
  phone: "เบอร์โทร (10 หลัก)",
});

const DEFAULT_AUDIT_ASK_FIELD_TEMPLATES = Object.freeze({
  customerName: "- ชื่อผู้รับ",
  shippingAddress: "- ที่อยู่",
  addressSubDistrict: "- ตำบล",
  addressDistrict: "- อำเภอ",
  addressProvince: "- จังหวัด",
  addressPostalCode: "- รหัสไปรษณีย์ (5 หลัก)",
  phone: "- เบอร์โทร (10 หลัก)",
});

function normalizeTemplateString(value, fallback) {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  return trimmed ? trimmed : fallback;
}

function renderTemplate(template, values = {}) {
  if (typeof template !== "string") return "";
  const safeValues = values && typeof values === "object" ? values : {};
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (match, key) => {
    if (!Object.prototype.hasOwnProperty.call(safeValues, key)) {
      return match;
    }
    const value = safeValues[key];
    return value === null || typeof value === "undefined" ? "" : String(value);
  });
}

function validateOrderDraft(draft, requiredFields = null) {
  const required =
    requiredFields && typeof requiredFields === "object"
      ? requiredFields
      : {
          customerName: true,
          shippingAddress: true,
          addressSubDistrict: true,
          addressDistrict: true,
          addressProvince: false,
          addressPostalCode: true,
          phone: true,
        };

  const normalized = { ...(draft || {}) };

  const normalizedPhone = normalizeThaiPhone(normalized.phone);
  normalized.phone = normalizedPhone;

  const normalizedPostal = normalizeThaiPostalCode(normalized.addressPostalCode);
  normalized.addressPostalCode = normalizedPostal;

  const missing = [];

  const isBlank = (value) => {
    if (value === null || typeof value === "undefined") return true;
    if (typeof value !== "string") return false;
    return value.trim().length === 0;
  };

  const ensureField = (field) => {
    if (!required[field]) return;
    if (field === "phone") {
      if (!normalized.phone) {
        missing.push({ field, label: FIELD_LABELS[field], reason: "missing" });
      }
      return;
    }
    if (field === "addressPostalCode") {
      if (!normalized.addressPostalCode) {
        missing.push({ field, label: FIELD_LABELS[field], reason: "missing" });
      }
      return;
    }
    if (isBlank(normalized[field])) {
      missing.push({ field, label: FIELD_LABELS[field], reason: "missing" });
    }
  };

  ensureField("customerName");
  ensureField("shippingAddress");
  ensureField("addressSubDistrict");
  ensureField("addressDistrict");
  ensureField("addressProvince");
  ensureField("addressPostalCode");
  ensureField("phone");

  return {
    normalizedDraft: normalized,
    missingFields: missing,
    isComplete: missing.length === 0,
  };
}

function formatOrderItemsLines(items) {
  if (!Array.isArray(items) || items.length === 0) return "";
  const lines = items
    .map((item) => {
      if (!item) return "";
      const product =
        typeof item.product === "string"
          ? item.product.trim()
          : typeof item.name === "string"
            ? item.name.trim()
            : "";
      const quantityRaw =
        typeof item.quantity === "number" && Number.isFinite(item.quantity)
          ? item.quantity
          : parseInt(item.quantity, 10);
      const quantity = Number.isFinite(quantityRaw) && quantityRaw > 0 ? quantityRaw : 1;
      if (!product) return "";
      return `${product} ${quantity} ชิ้น`;
    })
    .filter(Boolean);
  return lines.join("\n");
}

function buildAuditAskMessage(
  missingFields = [],
  options = DEFAULT_AUDIT_ASK_TEMPLATE,
) {
  if (!Array.isArray(missingFields) || missingFields.length === 0) {
    return "";
  }

  const normalizedOptions =
    typeof options === "string"
      ? { template: options }
      : options && typeof options === "object"
        ? options
        : {};

  const fieldTemplates =
    normalizedOptions.fieldTemplates &&
    typeof normalizedOptions.fieldTemplates === "object"
      ? normalizedOptions.fieldTemplates
      : {};

  const labels = [];
  const lines = missingFields
    .map((entry) => {
      if (!entry || typeof entry !== "object") return "";
      const fieldKey = typeof entry.field === "string" ? entry.field.trim() : "";
      const label = entry.label
        ? String(entry.label).trim()
        : FIELD_LABELS[fieldKey] || "";
      if (label) labels.push(label);

      const customTemplateRaw =
        fieldKey && typeof fieldTemplates[fieldKey] === "string"
          ? fieldTemplates[fieldKey].trim()
          : "";
      const fallbackLine =
        DEFAULT_AUDIT_ASK_FIELD_TEMPLATES[fieldKey] || (label ? `- ${label}` : "");
      const lineTemplate = customTemplateRaw || fallbackLine;
      if (!lineTemplate) return "";

      return renderTemplate(lineTemplate, {
        field_label: label,
        field_key: fieldKey,
      }).trim();
    })
    .filter(Boolean);

  if (!lines.length) return "";

  const missingLines = lines.join("\n");
  const missingText = labels.filter(Boolean).join(", ");
  const safeTemplate = normalizeTemplateString(
    normalizedOptions.template,
    DEFAULT_AUDIT_ASK_TEMPLATE,
  );

  return renderTemplate(safeTemplate, {
    missing_fields: missingLines,
    missing_fields_text: missingText,
  });
}

function buildAuditSummaryMessage(
  draft,
  template = DEFAULT_AUDIT_SUMMARY_TEMPLATE,
) {
  if (!draft || typeof draft !== "object") return "";

  const itemsLines = formatOrderItemsLines(draft.items);
  if (!itemsLines) return "";

  const totalRaw =
    typeof draft.totalAmount === "number" && Number.isFinite(draft.totalAmount)
      ? draft.totalAmount
      : parseInt(draft.totalAmount, 10);
  const totalAmount = Number.isFinite(totalRaw) && totalRaw > 0 ? totalRaw : null;

  const shippingCostRaw =
    typeof draft.shippingCost === "number" && Number.isFinite(draft.shippingCost)
      ? draft.shippingCost
      : parseInt(draft.shippingCost, 10);
  const shippingCost =
    Number.isFinite(shippingCostRaw) && shippingCostRaw >= 0 ? shippingCostRaw : null;

  const shippingLabel =
    shippingCost === 0
      ? "ส่งฟรี"
      : Number.isFinite(shippingCost) && shippingCost > 0
        ? `ค่าส่ง ${shippingCost} บาท`
        : "";

  const paymentMethod =
    typeof draft.paymentMethod === "string" ? draft.paymentMethod.trim() : "";
  const paymentLabel = paymentMethod
    ? paymentMethod.includes("ปลายทาง")
      ? "เก็บปลายทาง"
      : paymentMethod
    : "";

  const customerName =
    typeof draft.customerName === "string" ? draft.customerName.trim() : "";
  const phone = normalizeThaiPhone(draft.phone) || "";
  const addressText = buildAddressText(draft);

  const totalText = totalAmount !== null ? `${totalAmount} บาท` : "—";

  const paymentSummary = [shippingLabel, paymentLabel].filter(Boolean).join(" ");

  const safeTemplate = normalizeTemplateString(
    template,
    DEFAULT_AUDIT_SUMMARY_TEMPLATE,
  );

  const paymentSummaryText = paymentSummary ? ` ${paymentSummary}` : "";

  return renderTemplate(safeTemplate, {
    items_lines: itemsLines,
    total_text: totalText,
    total_amount: totalAmount !== null ? totalAmount : "",
    shipping_cost: shippingCost !== null ? shippingCost : "",
    shipping_label: shippingLabel,
    payment_label: paymentLabel,
    payment_method: paymentMethod,
    payment_summary: paymentSummaryText,
    customer_name: customerName || "-",
    address_text: addressText || "-",
    phone: phone || "-",
  });
}

module.exports = {
  DEFAULT_AUDIT_ASK_TEMPLATE,
  DEFAULT_AUDIT_ASK_FIELD_TEMPLATES,
  DEFAULT_AUDIT_SUMMARY_TEMPLATE,
  normalizeThaiPhone,
  normalizeThaiPostalCode,
  buildAddressText,
  validateOrderDraft,
  buildAuditAskMessage,
  buildAuditSummaryMessage,
};
