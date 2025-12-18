const { OpenAI } = require("openai");

const DEFAULT_ORDER_DRAFT_PROMPT_BODY = `วิเคราะห์บทสนทนาเพื่อสกัด "ออเดอร์แบบร่าง (order draft)" สำหรับการปิดการขาย

นิยาม order draft:
- ✅ เป็น order draft เมื่อ "ลูกค้ายืนยันสั่งซื้อ" หรือสรุปยอด/ยืนยันจำนวน/ยืนยันรับสินค้าอย่างชัดเจน
- ❌ ไม่เป็น order draft เมื่อเป็นการ "สอบถามอย่างเดียว" เช่น ถามราคา/สต๊อก/ขอดูรูป/ลังเล/ต่อรอง โดยยังไม่ยืนยันสั่งซื้อ

สิ่งที่ต้องสกัด (ถ้ามี):
- items: รายการสินค้า [{product, quantity, price}]
- totalAmount: ยอดรวม (ถ้าไม่ระบุให้คำนวณจาก items เท่าที่ทำได้)
- shippingCost: ค่าส่ง (ถ้าไม่ระบุให้เป็น 0)
- paymentMethod: วิธีชำระ ("เก็บเงินปลายทาง", "โอนเงิน", หรือ null)

ข้อมูลจัดส่ง (อาจยังไม่ครบได้ ให้ใส่ null เมื่อไม่พบ):
- customerName
- shippingAddress (ที่อยู่/บ้านเลขที่/หมู่/ซอย/ถนน หรือ "ที่อยู่เต็ม" ที่ลูกค้าพิมพ์)
- addressSubDistrict (ตำบล/แขวง)
- addressDistrict (อำเภอ/เขต)
- addressProvince (จังหวัด)
- addressPostalCode (รหัสไปรษณีย์)
- phone (เบอร์โทร)

⚠️ สำคัญ:
- ห้ามเดา/เติมข้อมูลที่ลูกค้าไม่ได้ให้มา
- ถ้าไม่มั่นใจว่าเป็น order draft ให้ตอบ hasDraft=false และ items=[]
- ให้ใช้ข้อมูลรอบล่าสุด (ถ้ามีหลายรอบ)`;

const ORDER_DRAFT_JSON_SUFFIX = `ตอบเป็น JSON เท่านั้น: {
  "hasDraft": true/false,
  "draft": {
    "items": [
      { "product": "ชื่อสินค้า", "quantity": จำนวน, "price": ราคา }
    ],
    "totalAmount": จำนวนหรือ null,
    "shippingCost": จำนวนหรือ 0,
    "paymentMethod": "วิธีชำระหรือ null",
    "customerName": "ชื่อหรือ null",
    "shippingAddress": "ที่อยู่หรือ null",
    "addressSubDistrict": "ตำบล/แขวงหรือ null",
    "addressDistrict": "อำเภอ/เขตหรือ null",
    "addressProvince": "จังหวัดหรือ null",
    "addressPostalCode": "รหัสไปรษณีย์หรือ null",
    "phone": "เบอร์โทรหรือ null"
  },
  "confidence": 0.0-1.0,
  "reason": "เหตุผลสั้นๆ"
}`;

function sanitizeDraftOutput(parsed) {
  if (!parsed || typeof parsed !== "object") {
    return { hasDraft: false, draft: { items: [] }, confidence: 0, reason: "" };
  }

  const hasDraft = !!parsed.hasDraft;
  const rawDraft = parsed.draft && typeof parsed.draft === "object" ? parsed.draft : {};

  const rawItems = Array.isArray(rawDraft.items) ? rawDraft.items : [];
  const items = rawItems
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const product =
        typeof item.product === "string"
          ? item.product.trim()
          : typeof item.name === "string"
            ? item.name.trim()
            : "";
      if (!product) return null;

      const quantityNumber = Number(item.quantity);
      const quantity =
        Number.isFinite(quantityNumber) && quantityNumber > 0
          ? quantityNumber
          : 1;

      const priceNumber = Number(item.price);
      const price =
        Number.isFinite(priceNumber) && priceNumber >= 0 ? priceNumber : null;

      return { product, quantity, price };
    })
    .filter(Boolean);

  const toTrimmedOrNull = (value) => {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  };

  const toNumberOrNull = (value) => {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim()) {
      const parsedNumber = Number(value.trim());
      if (Number.isFinite(parsedNumber)) return parsedNumber;
    }
    return null;
  };

  const shippingCostValue = toNumberOrNull(rawDraft.shippingCost);

  const draft = {
    items,
    totalAmount: toNumberOrNull(rawDraft.totalAmount),
    shippingCost:
      shippingCostValue === null || shippingCostValue < 0 ? 0 : shippingCostValue,
    paymentMethod: toTrimmedOrNull(rawDraft.paymentMethod),
    customerName: toTrimmedOrNull(rawDraft.customerName),
    shippingAddress: toTrimmedOrNull(rawDraft.shippingAddress),
    addressSubDistrict: toTrimmedOrNull(rawDraft.addressSubDistrict),
    addressDistrict: toTrimmedOrNull(rawDraft.addressDistrict),
    addressProvince: toTrimmedOrNull(rawDraft.addressProvince),
    addressPostalCode: toTrimmedOrNull(rawDraft.addressPostalCode),
    phone: toTrimmedOrNull(rawDraft.phone),
  };

  const confidence =
    typeof parsed.confidence === "number" && Number.isFinite(parsed.confidence)
      ? parsed.confidence
      : 0;

  const reason = typeof parsed.reason === "string" ? parsed.reason.trim() : "";

  if (!items.length) {
    return { hasDraft: false, draft: { ...draft, items: [] }, confidence, reason };
  }

  return { hasDraft, draft, confidence, reason };
}

async function extractOrderDraftFromChat(params = {}) {
  const {
    apiKey,
    model,
    messages,
  } = params || {};

  if (!apiKey) {
    return { hasDraft: false, draft: { items: [] }, confidence: 0, reason: "missing_api_key" };
  }

  const openai = new OpenAI({ apiKey });

  const systemPrompt = `${DEFAULT_ORDER_DRAFT_PROMPT_BODY}\n\n${ORDER_DRAFT_JSON_SUFFIX}`;

  const formattedConversation = Array.isArray(messages)
    ? messages
        .map((entry, index) => {
          const role = entry?.role === "user" ? "ลูกค้า" : "ร้าน";
          const content =
            typeof entry?.content === "string"
              ? entry.content
              : typeof entry?.displayContent === "string"
                ? entry.displayContent
                : "";
          const trimmed = content.trim();
          if (!trimmed) return "";
          return `${index + 1}. ${role}: ${trimmed}`;
        })
        .filter(Boolean)
        .join("\n")
    : "";

  if (!formattedConversation) {
    return { hasDraft: false, draft: { items: [] }, confidence: 0, reason: "no_messages" };
  }

  const userPrompt = `บทสนทนาทั้งหมด (จากเก่าสุดถึงใหม่สุด):\n\n${formattedConversation}\n\nสกัด order draft:`;

  try {
    const response = await openai.chat.completions.create({
      model: model || "gpt-4.1-nano",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.1,
    });

    const content = response.choices?.[0]?.message?.content || "";
    const trimmed = content.trim();

    let parsed = null;
    try {
      parsed = JSON.parse(trimmed);
    } catch (_) {
      const match = trimmed.match(/\{[\s\S]*\}/);
      if (match) {
        parsed = JSON.parse(match[0]);
      }
    }

    const sanitized = sanitizeDraftOutput(parsed);
    if (!sanitized.hasDraft) {
      return { ...sanitized, draft: { ...(sanitized.draft || {}), items: [] } };
    }
    return sanitized;
  } catch (error) {
    return {
      hasDraft: false,
      draft: { items: [] },
      confidence: 0,
      reason: error?.message || "openai_error",
    };
  }
}

module.exports = {
  DEFAULT_ORDER_DRAFT_PROMPT_BODY,
  ORDER_DRAFT_JSON_SUFFIX,
  extractOrderDraftFromChat,
};
