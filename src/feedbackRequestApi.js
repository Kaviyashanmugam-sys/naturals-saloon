import { Router } from "express";
import { sendFeedbackFlow } from "./whatsapp.js";
import { logWebhook, logWebhookError } from "./webhookLog.js";

const router = Router();

function normalizeMobile(value) {
  const digits = String(value || "").replace(/\D+/g, "");
  if (digits.length === 10) return `91${digits}`;
  if (digits.length === 11 && digits.startsWith("0")) return `91${digits.slice(1)}`;
  if (digits.length === 12 && digits.startsWith("91")) return digits;
  return digits;
}

/**
 * POST /api/send-feedback-request
 *
 * Sends a 1–5 star WhatsApp rating request to the customer.
 * On reply:
 *   4–5 stars → bot sends the Google Review URL
 *   1–3 stars → bot asks for typed feedback, stores it internally
 *
 * Body params:
 *   customer_mobile    string  required  e.g. "7708420110"
 *   customer_name      string  required  e.g. "Sasikumar"
 *   branch_name        string  required  e.g. "ANNANAGAR"
 *   appointment_id     number  optional  e.g. 96382
 *   google_place_id    string  optional  e.g. "ChIJN1t_tDeuEmsRUsoyG83frY4" (preferred)
 *   google_review_url  string  optional  fallback if google_place_id not provided
 */
router.post("/api/send-feedback-request", async (req, res) => {
  const {
    customer_mobile,
    customer_name,
    branch_name,
    appointment_id,
    google_place_id,
    google_review_url
  } = req.body || {};

  if (!customer_mobile || !customer_name || !branch_name) {
    return res.status(400).json({
      success: false,
      message: "customer_mobile, customer_name, branch_name are required"
    });
  }

  const to = normalizeMobile(customer_mobile);
  if (!to || to.length < 10) {
    return res.status(400).json({ success: false, message: "Invalid customer_mobile" });
  }

  const reviewUrl = google_place_id
    ? `https://search.google.com/local/writereview?placeid=${encodeURIComponent(google_place_id)}`
    : (google_review_url || "");

  const flowToken = `fb_${Date.now()}_${String(appointment_id || Math.floor(Math.random() * 9999))}`;
  try {
    await sendFeedbackFlow(to, flowToken, reviewUrl);
    logWebhook("feedback_request_api", `flow sent to=${to} appointment_id=${appointment_id || "n/a"}`);
    return res.status(200).json({ success: true, message: "Feedback request sent successfully" });
  } catch (err) {
    logWebhookError("feedback_request_api", err);
    return res.status(500).json({
      success: false,
      message: "Failed to send feedback request",
      error: err.message
    });
  }
});

export default router;
