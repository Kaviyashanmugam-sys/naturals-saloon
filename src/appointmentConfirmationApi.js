import { Router } from "express";
import { sendText } from "./whatsapp.js";
import { logWebhook, logWebhookError } from "./webhookLog.js";

const router = Router();

function normalizeMobile(value) {
  const digits = String(value || "").replace(/\D+/g, "");
  if (digits.length === 10) return `91${digits}`;
  if (digits.length === 11 && digits.startsWith("0")) return `91${digits.slice(1)}`;
  if (digits.length === 12 && digits.startsWith("91")) return digits;
  return digits;
}

function generateReferenceId() {
  return `MSG${Date.now()}${Math.floor(Math.random() * 1000).toString().padStart(3, "0")}`;
}

/**
 * POST /api/appointment-confirmed
 *
 * Called by the external appointment system when an appointment is confirmed.
 * Sends a WhatsApp notification to the customer and returns a reference ID.
 *
 * Required fields: customer_mobile, customer_name, branch_name,
 *                  appointment_date, appointment_time
 */
router.post("/api/appointment-confirmed", async (req, res) => {
  const {
    appointment_id,
    customer_name,
    customer_mobile,
    branch_name,
    appointment_date,
    appointment_time,
    location_map_url,
    reschedule_contact,
    online_booking_url,
    message
  } = req.body || {};

  if (!customer_mobile || !customer_name || !branch_name || !appointment_date || !appointment_time) {
    return res.status(400).json({
      success: false,
      message: "customer_mobile, customer_name, branch_name, appointment_date and appointment_time are required"
    });
  }

  const to = normalizeMobile(customer_mobile);
  if (!to || to.length < 10) {
    return res.status(400).json({ success: false, message: "Invalid customer_mobile" });
  }

  // Use the pre-built message from the payload if provided, otherwise build one.
  const whatsappMessage = message || buildConfirmationMessage({
    appointment_id,
    customer_name,
    branch_name,
    appointment_date,
    appointment_time,
    location_map_url,
    reschedule_contact,
    online_booking_url
  });

  const referenceId = generateReferenceId();

  logWebhook("appointment_confirmed_api", `appointment_id=${appointment_id || "n/a"} to=${to} ref=${referenceId}`);

  try {
    await sendText(to, whatsappMessage);
    logWebhook("appointment_confirmed_api", `WhatsApp sent OK ref=${referenceId}`);

    return res.status(200).json({
      success: true,
      message: "Notification sent successfully",
      reference_id: referenceId
    });
  } catch (err) {
    logWebhookError("appointment_confirmed_api", err);
    return res.status(500).json({
      success: false,
      message: "Failed to send WhatsApp notification",
      error: err.message
    });
  }
});

function buildConfirmationMessage({ appointment_id, customer_name, branch_name, appointment_date, appointment_time, location_map_url, reschedule_contact, online_booking_url }) {
  const dateFmt = formatDate(appointment_date);
  const lines = [
    `✅ *Naturals — Appointment Confirmed!*`,
    ``,
    `Hello ${customer_name} 👋`,
    ``,
    `Your appointment has been *confirmed*. We look forward to seeing you! 🎉`,
    ``,
    `━━━━━━━━━━━━━━━━━━`,
    `🏪 *Branch:* ${branch_name}`,
    `📅 *Date:* ${dateFmt}`,
    `⏰ *Time:* ${appointment_time}`,
    ...(appointment_id ? [`🔖 *Booking ID:* ${appointment_id}`] : []),
    `━━━━━━━━━━━━━━━━━━`,
    ...(location_map_url ? [``, `📌 *Directions:* ${location_map_url}`] : []),
    ...(reschedule_contact ? [``, `📞 *To reschedule:* Call ${reschedule_contact}`] : []),
    ...(online_booking_url ? [``, `🌐 *Book online:* ${online_booking_url}`] : []),
    ``,
    `See you soon! 💚`,
    ``,
    `_Naturals — Unisex Hair & Style Salon_`
  ];
  return lines.join("\n");
}

function formatDate(dateStr) {
  const m = String(dateStr || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return dateStr;
  return `${m[3]}/${m[2]}/${m[1]}`;
}

export default router;
