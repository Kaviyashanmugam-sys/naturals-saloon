import { formatServicesPrettyFromBlob } from "./bookingEngine.js";

/**
 * Parse WhatsApp Flow completion from inbound webhook (interactive.nfm_reply).
 * @see https://developers.facebook.com/docs/whatsapp/flows/guides/receiveflowresponse/
 */

export function parseNfmReplyPayload(msg) {
  const nfm = msg?.interactive?.nfm_reply;
  if (!nfm) return null;

  const raw = nfm.response_json;
  if (raw == null) return null;

  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (parsed && typeof parsed === "object") {
      if (parsed.response && typeof parsed.response === "object") {
        return { ...parsed, ...parsed.response };
      }
      return parsed;
    }
  } catch {
    return null;
  }

  return null;
}

/** Feedback Flow completion — booking completions always include `booking_date`. */
export function isFeedbackFlowPayload(data) {
  if (!data || typeof data !== "object") return false;
  if (Object.prototype.hasOwnProperty.call(data, "booking_date")) return false;
  return (
    Object.prototype.hasOwnProperty.call(data, "overall_experience") ||
    Object.prototype.hasOwnProperty.call(data, "staff_performance") ||
    Object.prototype.hasOwnProperty.call(data, "amenities_rating")
  );
}

function starRatingLabel(id) {
  const m = String(id || "").match(/^(\d)_/);
  if (!m) return id || "—";
  const n = Number(m[1]);
  const labels = { 5: "Excellent (5/5)", 4: "Good (4/5)", 3: "Average (3/5)", 2: "Below Average (2/5)", 1: "Poor (1/5)" };
  return labels[n] || id;
}

export function formatFeedbackThankYou(data) {
  if (!data || typeof data !== "object") {
    return "💚 Thank you for your feedback! — Naturals";
  }

  const reviewText = String(data.review_text || "").trim();

  const lines = [
    "💚 *Thank you for your feedback!*",
    "",
    "*Staff performance:* " + starRatingLabel(data.staff_performance),
    "*Amenities & facilities:* " + starRatingLabel(data.amenities_rating),
    "*Overall experience:* " + starRatingLabel(data.overall_experience)
  ];
  if (reviewText) {
    lines.push("", "*Your review:*", reviewText);
  }
  lines.push("", "_Naturals — Unisex Hair & Style Salon_");
  return lines.join("\n");
}

/** Returns the Google Review URL from the feedback payload if present, else null. */
export function extractGoogleReviewUrl(data) {
  const url = String(data?.google_review_url || "").trim();
  return url && url.startsWith("http") ? url : null;
}

function formatDate(isoDate) {
  const m = String(isoDate || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : (isoDate || "—");
}

export function formatBookingSummaryFromFlow(data) {
  if (!data || typeof data !== "object") {
    return "Thank you. We received your booking request and will contact you shortly.";
  }

  const name = data.customer_name || "Customer";
  const salon = data.salon_name || data.salon_id || "Salon";
  const service =
    data.service_item_pretty ||
    formatServicesPrettyFromBlob(data.service_blob) ||
    data.service_item ||
    data.service_category ||
    "—";
  const when = formatDate(data.booking_date);
  const time = data.slot_id || "—";
  const stylist = data.stylist_name || data.stylist_id || "—";
  const bookingId = data.booking_id || (data.flow_token ? `GT-FLOW-${data.flow_token}` : "—");
  const mapsUrl = data.maps_url ||
    (data.salon_latitude && data.salon_longitude
      ? `https://maps.google.com/?q=${data.salon_latitude},${data.salon_longitude}`
      : "");
  const lines = [
    `✅ *Naturals — Booking Request Received*`,
    ``,
    `Hello ${name} 👋`,
    ``,
    `Your booking request has been received. We will contact you shortly.`,
    ``,
    `*Salon:* ${salon}`,
    ``,
    ...(data.salon_address_line ? [`*Address:* ${data.salon_address_line}`] : []),
    ...(mapsUrl ? [`🗺️ ${mapsUrl}`] : []),
    ...(data.salon_address_line || mapsUrl ? [""] : []),
    `💇 *Services:* ${service}`,
    ``,
    `📅 *Date:* ${when}`,
    ``,
    `⏰ *Time:* ${time}`,
    ``,
    `👩‍🔧 *Stylist:* ${stylist}`
  ];

  lines.push(
    ``,
    `Our team will contact you shortly to confirm your slot. Thank you for your patience.`,
    ``,
    `_💚 Naturals — Unisex Hair & Style Salon_`
  );

  return lines.join("\n");
}
