# ✅ AI Order Audit (Sidecar) — Implementation Summary

> **Date:** 2025-12-19  
> **Spec (single source):** `docs/ai-audit-system.md`  
> **Dev plan:** `docs/ai-audit-development-plan.md`

เอกสารนี้สรุป “สิ่งที่พัฒนาเสร็จแล้ว” สำหรับระบบ **AI Order Audit** (ระบบแยกจาก AI หลัก) ที่ทำหน้าที่:
- สกัด **order draft** (ต้องมี `items >= 1`)
- ตรวจความครบถ้วนข้อมูลจัดส่ง
- ส่งข้อความได้แค่ 2 แบบ: **ถามข้อมูลที่ขาด** หรือ **สรุปออเดอร์เพื่อยืนยัน**
- เปิด/ปิดได้รายเพจในหน้า Settings

---

## 1) โครงสร้างที่เพิ่ม (High-level)

### 1.1 Services (โมดูลใหม่)
- `services/orderDraftExtractor.js`
  - เรียก OpenAI เพื่อคืน `{ hasDraft, draft, confidence, reason }`
- `services/orderAuditService.js`
  - `normalizeThaiPhone()` / `normalizeThaiPostalCode()`
  - `validateOrderDraft()` → คืน `missingFields[]` + `isComplete`
  - `buildAuditAskMessage()` / `buildAuditSummaryMessage()`

### 1.2 DB / Collections
- ใช้ `follow_up_page_settings.orderAudit` เป็น per-page settings
- เพิ่ม `order_audit_sessions`
  - unique index: `{ pageKey, userId }`
  - TTL: field `expireAt` (เก็บ session ~14 วัน)
  - index: `pending.dueAt` สำหรับ due-sender

---

## 2) Flow ที่ทำงานจริงในระบบ (สรุปตามสเปค)

### 2.1 Trigger (ลูกค้า + แอดมินทั้ง 2 ช่องทาง)
Runner ถูก trigger เมื่อมีข้อความใหม่ (ยกเว้นข้อความของ audit เอง):
- ลูกค้า: ผ่าน `saveChatHistory()` (`role:"user"`)
- แอดมินหน้าเว็บ: `POST /admin/chat/send` (`source:"admin_chat"`)
- แอดมินตอบจาก Facebook inbox: webhook echo (`source:"admin_page"`)

### 2.2 เงื่อนไข “ส่งข้อความ”
ระบบจะส่ง **เฉพาะเมื่อ**
- extractor คืน `hasDraft=true`
- และ `draft.items.length >= 1`

ถ้า `items` ว่าง → **ไม่ส่งข้อความ**

### 2.3 หน่วงเวลาเมื่อ AI หลักเปิด
- ถ้า AI หลัก **ปิด** → audit ส่งได้ทันที
- ถ้า AI หลัก **เปิด** → audit ตั้ง `session.pending` และรอ `waitForMainAiSeconds` ก่อนส่ง (ทั้งถาม/สรุป)
- ระหว่างรอถ้ามีข้อความใหม่จากลูกค้า (`role:"user"`) → due-sender จะยกเลิก pending และปล่อยให้ runner รอบล่าสุดคำนวณใหม่

### 2.4 Loop prevention (กันวนจากข้อความของระบบเอง)
- ทุกข้อความที่ audit ส่งจะติด `source:"order_audit"` และ `metadata:"order_audit"`
- Runner ignore ข้อความที่มี `source/metadata = order_audit`
- Facebook echo จะ skip `metadata:"order_audit"` (ไม่บันทึกซ้ำ/ไม่ trigger ซ้ำ)

---

## 3) Admin UI / Settings (ใช้งานได้แล้ว)

หน้า `views/admin-orders.ejs` (modal ตั้งค่าเดิม) เพิ่มส่วน **Order Audit**:
- เปิด/ปิดรายเพจ: `orderAudit.enabled`
- หน่วงเวลาเมื่อ AI หลักเปิด: `waitForMainAiSeconds`

หมายเหตุ (MVP):
- ส่งแบบ push ไปหาลูกค้าเท่านั้น (`push_customer`)
- ตรวจขั้นต่ำแบบ fixed: `customerName`, `shippingAddress`, `addressSubDistrict`, `addressDistrict`, `addressPostalCode` (5 หลัก), `phone` (10 หลัก)

Backend endpoints:
- `GET /admin/orders/pages` → ส่ง `pages[].orderAudit` กลับให้ UI
- `POST /admin/orders/pages/audit-settings` → บันทึก `follow_up_page_settings.orderAudit` (normalize ก่อนเก็บ)

---

## 4) จุดที่แตะโค้ดหลัก (สำหรับตามรอย)

- `index.js`
  - `// ============================ Order Audit (AI sidecar) ============================`
  - `runOrderAuditForNewMessage()` (runner)
  - `processDueOrderAuditSessions()` + `startOrderAuditWorker()` (due-sender)
  - `deliverOrderAuditMessage()` (push LINE/FB + บันทึก chat_history)
- `views/admin-orders.ejs` (UI settings)

---

## 5) ข้อจำกัด/สิ่งที่ตั้งใจไม่ทำใน MVP

- ยังไม่มี “template editor ต่อเพจ” (ใช้ template แบบ fixed ในโค้ด)
- ไม่มี automated test suite ใน repo (แนะนำทดสอบตาม Test Cases ใน `docs/ai-audit-system.md`)

---

## 6) วิธีทดสอบแบบสั้น (แนะนำ)

1) เปิด `Order Audit` ในหน้า `/admin/orders` → เลือกเพจ → เปิด toggle  
2) ตั้ง `waitForMainAiSeconds=60` แล้วลองเคส:
   - ข้อความ “ถามราคาอย่างเดียว” → ต้องไม่ส่ง
   - ข้อความ “เอา 1 ชิ้น” แต่ขาดเบอร์/ที่อยู่ → ต้องถาม (หลังรอครบเวลา เมื่อ AI หลักเปิด)
   - ระหว่างรอ 60 วิ ลูกค้าส่งเบอร์เพิ่ม → ต้อง “ไม่ส่งข้อความเดิม” และคำนวณใหม่
