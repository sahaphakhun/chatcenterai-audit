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

const FIELD_LABELS = Object.freeze({
  customerName: "ชื่อผู้รับ",
  shippingAddress: "ที่อยู่",
  addressSubDistrict: "ตำบล",
  addressDistrict: "อำเภอ",
  addressProvince: "จังหวัด",
  addressPostalCode: "รหัสไปรษณีย์ (5 หลัก)",
  phone: "เบอร์โทร (10 หลัก)",
});

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

function buildAuditAskMessage(missingFields = []) {
  if (!Array.isArray(missingFields) || missingFields.length === 0) {
    return "";
  }

  const labels = missingFields
    .map((entry) => (entry && entry.label ? String(entry.label).trim() : ""))
    .filter(Boolean);

  if (!labels.length) return "";

  return `ขอข้อมูลจัดส่งเพิ่มเติมเพื่อสรุปออเดอร์นะคะ 🙏\n${labels
    .map((label) => `- ${label}`)
    .join("\n")}\n\nพิมพ์รวมในข้อความเดียวได้เลยค่ะ`;
}

function buildAuditSummaryMessage(draft) {
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

  return `✅ขอบคุณค่ะ สรุปรายการดังนี้\n\n${itemsLines}\n⭐️ยอดรวม ${totalText}${paymentSummary ? ` ${paymentSummary}` : ""}\n\nชื่อ: ${customerName || "-"}\nที่อยู่: ${addressText || "-"}\nโทร: ${phone || "-"}\n\n🚚จัดส่งภายใน 2-3 วันทำการค่ะ\nหากมีเลขพัสดุจะแจ้งให้ทราบอีกครั้ง ขอบคุณมากค่ะ✅`;
}

module.exports = {
  normalizeThaiPhone,
  normalizeThaiPostalCode,
  buildAddressText,
  validateOrderDraft,
  buildAuditAskMessage,
  buildAuditSummaryMessage,
};
