import axios from "axios";
import { config } from "./config.js";
import { insertNotificationLog } from "./database.js";
import { logWebhook, logWebhookError } from "./webhookLog.js";

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatDateDDMMYYYY(dateStr) {
  if (!dateStr) return dateStr;
  const m = String(dateStr).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return dateStr;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

function formatMobileShort(mobile) {
  const digits = String(mobile || "").replace(/\D+/g, "");
  if (digits.startsWith("91") && digits.length === 12) return digits.slice(2);
  return digits;
}

function buildMessage({ customerName, branchName, appointmentDate, appointmentTime, locationMapUrl, rescheduleContact, onlineBookingUrl }) {
  const dateFmt = formatDateDDMMYYYY(appointmentDate);
  return (
    `Dear ${customerName}, Thank you for choosing ${branchName}, your appointment on ${dateFmt} at ${appointmentTime} is confirmed.` +
    ` Location map ${locationMapUrl}` +
    ` To reschedule, please call ${rescheduleContact}.` +
    ` Try booking your next appointment online at ${onlineBookingUrl}`
  );
}

export async function sendConfirmationNotification({
  appointmentId,
  customerName,
  customerMobile,
  branchName,
  appointmentDate,
  appointmentTime,
  locationMapUrl,
  rescheduleContact,
  onlineBookingUrl
}) {
  const webhookUrl = config.confirmationWebhookUrl;
  if (!webhookUrl) {
    logWebhook("confirmation_notifier", "SKIPPED — CONFIRMATION_WEBHOOK_URL not set");
    return { skipped: true };
  }

  const resolvedReschedule = rescheduleContact || config.rescheduleContact || "";
  const resolvedBookingUrl = onlineBookingUrl || config.onlineBookingUrl || "";
  const mobileShort = formatMobileShort(customerMobile);

  const payload = {
    appointment_id: appointmentId || "",
    customer_name: customerName || "",
    customer_mobile: mobileShort,
    branch_name: branchName || "",
    appointment_date: appointmentDate || "",
    appointment_time: appointmentTime || "",
    location_map_url: locationMapUrl || "",
    reschedule_contact: resolvedReschedule,
    online_booking_url: resolvedBookingUrl,
    message_type: "appointment_confirmation",
    message: buildMessage({
      customerName: customerName || "",
      branchName: branchName || "",
      appointmentDate: appointmentDate || "",
      appointmentTime: appointmentTime || "",
      locationMapUrl: locationMapUrl || "",
      rescheduleContact: resolvedReschedule,
      onlineBookingUrl: resolvedBookingUrl
    })
  };

  let lastError = null;
  let attempt = 0;

  while (attempt < MAX_RETRIES) {
    attempt++;
    const attemptedAt = new Date().toISOString();

    try {
      logWebhook("confirmation_notifier", `attempt=${attempt} POST ${webhookUrl} appointment_id=${appointmentId}`);
      logWebhook("confirmation_notifier", `request_payload=${JSON.stringify(payload)}`);

      const response = await axios.post(webhookUrl, payload, {
        headers: { "Content-Type": "application/json" },
        timeout: 10000
      });

      const responseData = response.data || {};
      const referenceId = responseData.reference_id || responseData.referenceId || responseData.id || null;

      logWebhook("confirmation_notifier", `attempt=${attempt} success status=${response.status} reference_id=${referenceId}`);
      logWebhook("confirmation_notifier", `response=${JSON.stringify(responseData)}`);

      await insertNotificationLog({
        appointmentId,
        customerMobile: mobileShort,
        webhookUrl,
        attempt,
        status: "delivered",
        httpStatus: response.status,
        referenceId,
        requestPayload: payload,
        responsePayload: responseData,
        attemptedAt
      });

      return { success: true, referenceId, attempt, responseData };
    } catch (err) {
      lastError = err;
      const httpStatus = err?.response?.status || null;
      const responseData = err?.response?.data || null;

      logWebhookError(`confirmation_notifier attempt=${attempt}`, err);

      await insertNotificationLog({
        appointmentId,
        customerMobile: mobileShort,
        webhookUrl,
        attempt,
        status: attempt < MAX_RETRIES ? "retry" : "failed",
        httpStatus,
        referenceId: null,
        requestPayload: payload,
        responsePayload: responseData,
        errorMessage: err.message,
        attemptedAt
      });

      if (attempt < MAX_RETRIES) {
        await delay(RETRY_DELAY_MS * attempt);
      }
    }
  }

  logWebhookError("confirmation_notifier", new Error(`all ${MAX_RETRIES} attempts failed for appointment_id=${appointmentId}`));
  return { success: false, error: lastError?.message, attempt: MAX_RETRIES };
}
