import axios from "axios";
import { config } from "./config.js";
import {
  formatSalonListDescription,
  getSalonListTitle,
  getGenderRadioOptions
} from "./bookingEngine.js";

const baseUrl = `https://graph.facebook.com/v22.0/${config.phoneNumberId}/messages`;

async function sendMessage(payload) {
  if (!config.whatsappToken || !config.phoneNumberId) {
    throw new Error("Missing WhatsApp credentials in .env");
  }

  const { data, status } = await axios.post(baseUrl, payload, {
    headers: {
      Authorization: `Bearer ${config.whatsappToken}`,
      "Content-Type": "application/json"
    },
    validateStatus: () => true
  });

  console.log(data,status)

  if (status >= 400 || data?.error) {
    const err = data?.error || { message: `HTTP ${status}` };
    const parts = [
      err.message || JSON.stringify(err),
      err.code != null ? `code=${err.code}` : null,
      err.error_subcode != null ? `subcode=${err.error_subcode}` : null,
      err.error_data ? `data=${JSON.stringify(err.error_data)}` : null,
      err.fbtrace_id ? `fbtrace_id=${err.fbtrace_id}` : null
    ].filter(Boolean);
    throw new Error(`WhatsApp API: ${parts.join(" | ")}`);
  }

  return data;
}

async function sendFlowMessage(payload) {
  console.log("Flow Message");
  const flowbaseUrl = `https://graph.facebook.com/v22.0/${config.phoneNumberId}/messages`;
  
  const { data, status } = await axios.post(flowbaseUrl, payload, {
    headers: {
      Authorization: "Bearer EAAdgUfllkyMBRcnyPu1Sku5PmgPt5XLFpEKo5ZBdJWhZCQ5WIIZCjT4aQpBqHUXPsHdqzbuHUIHlmK8NobG9BAOZAtuRZBLXoyNLZAVJ8sqpRQW7DOeak42bxzPSzs8IZBJ5EM2xTUoH0oZBXv59yn3zOPfBpyp8vstRaKjpbZCSEkVc00YjUkpjFghtGBUczuAZDZD",
      "Content-Type": "application/json"
    },
    validateStatus: () => true
  });

  console.log(flowbaseUrl);


  if (status >= 400 || data?.error) {
    const err = data?.error || { message: `HTTP ${status}` };
    const parts = [
      err.message || JSON.stringify(err),
      err.code != null ? `code=${err.code}` : null,
      err.error_subcode != null ? `subcode=${err.error_subcode}` : null,
      err.error_data ? `data=${JSON.stringify(err.error_data)}` : null,
      err.fbtrace_id ? `fbtrace_id=${err.fbtrace_id}` : null
    ].filter(Boolean);
    throw new Error(`WhatsApp API: ${parts.join(" | ")}`);
  }

  return data;
}

export async function sendText(to, body) {
  return sendMessage({
    messaging_product: "whatsapp",
    to,
    type: "text",
    text: { body }
  });
}

/** Direct HTTPS URL to a JPEG/PNG; WhatsApp fetches this server-side (no auth). */
export async function sendImage(to, imageLink, caption) {
  return sendMessage({
    messaging_product: "whatsapp",
    to,
    type: "image",
    image: {
      link: imageLink,
      caption
    }
  });
}

/** Must match ENTRY screen `data` in the published Flow JSON (dynamic_object — empty `{}` is rejected). */
function entryFlowInitialData() {
  return {
    customer_name: "",
    customer_mobile: "",
    customer_email: "",
    gender_options: getGenderRadioOptions(),
    salon_id: "",
    salon_name: "",
    salon_address_line: "",
    maps_url: "",
    salon_latitude: "",
    salon_longitude: ""
  };
}

/**
 * Native WhatsApp "Send location" CTA (within 24h session).
 * @see https://developers.facebook.com/docs/whatsapp/cloud-api/guides/send-messages/location-request-messages/
 */
export async function sendLocationRequestMessage(to, bodyText) {
  const text =
    bodyText ||
    "📍 Tap *Send location* below so we can list nearby Naturals salons for you.";
  return sendMessage({
    messaging_product: "whatsapp",
    to,
    type: "interactive",
    interactive: {
      type: "location_request_message",
      body: { text },
      action: { name: "send_location" }
    }
  });
}

export async function sendLocationInputOptionsList(to) {
  return sendMessage({
    messaging_product: "whatsapp",
    to,
    type: "interactive",
    interactive: {
      type: "list",
      header: { type: "text", text: "Share your location details 📍" },
      body: {
        text: "Choose one option so we can find nearby Naturals salons."
      },
      footer: { text: "Naturals" },
      action: {
        button: "Choose option",
        sections: [
          {
            title: "Location options",
            rows: [
              {
                id: "loc_mode_live",
                title: "Live Location",
                description: "Share your current location from WhatsApp"
              },
              {
                id: "loc_mode_city",
                title: "Area",
                description: "Type your city, area name or pincode"
              }
            ]
          }
        ]
      }
    }
  });
}

/** Interactive list (max 10 rows). Each row id = salon_id. */
export async function sendSalonListMessage(to, salonRows, headerText, bodyText) {
  const rows = (salonRows || []).slice(0, 10).map((s) => ({
    id: s.id,
    title: getSalonListTitle(s),
    description: formatSalonListDescription(s)
  }));

  return sendMessage({
    messaging_product: "whatsapp",
    to,
    type: "interactive",
    interactive: {
      type: "list",
      header: { type: "text", text: headerText || "Nearby salons ✨" },
      body: {
        text: bodyText || "Tap a salon to book."
      },
      footer: { text: "Naturals" },
      action: {
        button: "Choose salon",
        sections: [{ title: "Near you", rows }]
      }
    }
  });
}

export async function sendPromptWithBackButton(to, bodyText) {
  return sendMessage({
    messaging_product: "whatsapp",
    to,
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: bodyText },
      action: {
        buttons: [
          {
            type: "reply",
            reply: { id: "loc_change_option", title: "Change option" }
          }
        ]
      }
    }
  });
}

export async function sendSalonConfirmButtons(to, salon) {
  const lines = [
    `🏪 *${salon.name}*`,
    ...(salon.addressLine1 ? [`📍 ${salon.addressLine1}`] : []),
    ...(salon.distanceKm != null ? [`📏 ${Number(salon.distanceKm).toFixed(1)} km away`] : []),
    ...(salon.mapsUrl ? [`🗺️ *View on Google Maps:* ${salon.mapsUrl}`] : []),
    ``,
    `Would you like to book at this salon?`
  ];

  return sendMessage({
    messaging_product: "whatsapp",
    to,
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: lines.join("\n") },
      action: {
        buttons: [
          { type: "reply", reply: { id: "confirm_salon", title: "Continue Booking" } },
          { type: "reply", reply: { id: "change_salon", title: "Change Location" } }
        ]
      }
    }
  });
}

export async function sendWelcomeActionButtons(to) {
  return sendMessage({
    messaging_product: "whatsapp",
    to,
    type: "interactive",
    interactive: {
      type: "button",
      body: {
        text: "What would you like to do next?"
      },
      action: {
        buttons: [
          {
            type: "reply",
            reply: { id: "action_book", title: "Book Appointment" }
          }
        ]
      }
    }
  });
}

export async function sendMainMenuList(to) {
  return sendMessage({
    messaging_product: "whatsapp",
    to,
    type: "interactive",
    interactive: {
      type: "list",
      header: { type: "text", text: "Naturals — Menu 💚" },
      body: { text: "What would you like to do? Please choose an option below." },
      footer: { text: "Naturals" },
      action: {
        button: "View Options",
        sections: [
          {
            title: "Appointment Options",
            rows: [
              {
                id: "menu_change_location",
                title: "Change Location",
                description: "Pick a different location or area"
              },
              {
                id: "menu_change_salon",
                title: "Change Salon",
                description: "Choose a different Naturals salon"
              },
              {
                id: "menu_restart",
                title: "Book from Start",
                description: "Start your booking over from the beginning"
              }
            ]
          }
        ]
      }
    }
  });
}

/** Must match FEEDBACK_RATES screen `data` in the published feedback Flow. */
function feedbackFlowInitialData(googleReviewUrl = "") {
  return {
    google_review_url: googleReviewUrl || ""
  };
}

/** 2-screen feedback Flow: ratings → Google Review prompt. */
export async function sendFeedbackFlow(to, flowToken = "", googleReviewUrl = "") {
  if (!config.flowIdFeedback || config.flowIdFeedback.includes("replace")) {
    throw new Error("FLOW_ID_FEEDBACK is not configured");
  }
  const token = String(flowToken || `token_${Date.now()}`);
  const data = feedbackFlowInitialData(googleReviewUrl);

  return sendMessage({
    messaging_product: "whatsapp",
    to,
    type: "interactive",
    interactive: {
      type: "flow",
      header: {
        type: "text",
        text: "Naturals — Your feedback"
      },
      body: {
        text: "Rate your experience and help us improve 💚\nIt only takes a minute!"
      },
      footer: {
        text: "Naturals"
      },
      action: {
        name: "flow",
        parameters: {
          flow_message_version: "3",
          flow_token: token,
          flow_id: config.flowIdFeedback,
          flow_cta: "Rate My Experience",
          flow_action: "navigate",
          flow_action_payload: {
            screen: "FEEDBACK_RATES",
            data
          }
        }
      }
    }
  });
}

export async function sendBookingFlow(to, initialData = {}, flowToken = "") {
  const data = { ...entryFlowInitialData(), ...initialData };
  const token = String(flowToken || `token_${Date.now()}`);

  const bodyLines = [];
  if (data.salon_name) bodyLines.push(`🏪 *${data.salon_name}*`);
  if (data.salon_address_line) bodyLines.push(`📍 ${data.salon_address_line}`);
  bodyLines.push(`📞 ${(data.salon_phone && data.salon_phone !== "0") ? data.salon_phone : "-"}`);
  if (data.maps_url) bodyLines.push(`🗺️ ${data.maps_url}`);
  if (bodyLines.length) bodyLines.push("");
  bodyLines.push("Tap below to book your appointment.");

  return sendMessage({
    messaging_product: "whatsapp",
    to,
    type: "interactive",
    interactive: {
      type: "flow",
      header: {
        type: "text",
        text: "Naturals Appointment Booking"
      },
      body: {
        text: bodyLines.join("\n")
      },
      footer: {
        text: "Naturals"
      },
      action: {
        name: "flow",
        parameters: {
          flow_message_version: "3",
          flow_token: token,
          flow_id: config.flowIdBookAppointment,
          flow_cta: "Continue Booking",
          flow_action: "navigate",
          flow_action_payload: {
            screen: "ENTRY",
            data
          }
        }
      }
    }
  });
}

export async function sendBookingConfirmed(to, booking) {
  const stylistName =
    !booking.stylistName || booking.stylistName === "No Preference"
      ? "Auto Assigned Stylist"
      : booking.stylistName;

  const lines = [
    `✅ *Naturals — Booking Confirmed!*`,
    ``,
    `Hello ${booking.customerName || "there"} 👋`,
    ``,
    `Great news! Your appointment has been *confirmed*. We look forward to seeing you! 🎉`,
    ``,
    `━━━━━━━━━━━━━━━━━━`,
    `🏪 *Salon:* ${booking.salonName || "—"}`,
    ...(booking.address ? [`📍 *Address:* ${booking.address}`] : []),
    ``,
    `💇 *Services:* ${booking.services || "—"}`,
    ``,
    `📅 *Date:* ${(() => { const m = String(booking.date || "").match(/^(\d{4})-(\d{2})-(\d{2})$/); return m ? `${m[3]}/${m[2]}/${m[1]}` : (booking.date || "—"); })()}`,
    `⏰ *Time:* ${booking.timeSlot || "—"}`,
    `👩‍🔧 *Stylist:* ${stylistName}`,
    ...(booking.bookingId ? [`🔖 *Booking ID:* ${booking.bookingId}`] : []),
    `━━━━━━━━━━━━━━━━━━`,
    ...(booking.mapsUrl ? [``, `📌 *Directions:* ${booking.mapsUrl}`] : []),
    ``,
    `See you soon! 💚`,
    ``,
    `_Naturals — Unisex Hair & Style Salon_`
  ];

  return sendText(to, lines.join("\n"));
}

export async function sendBookingRejected(to, customerName, reason, alternateSlots) {
  const greeting = customerName ? `Hello ${customerName} 👋\n\n` : "";
  const reasonLine = `*Reason:* ${reason || "slot unavailable"}`;
  const slotsLines = alternateSlots && alternateSlots.length
    ? [``, `Here are some available slots you can choose from:`, ...alternateSlots.map((s) => `• ${s}`)]
    : [];

  const lines = [
    `❌ *Naturals — Booking Update*`,
    ``,
    `${greeting}We're sorry, but your booking request could not be confirmed.`,
    ``,
    reasonLine,
    ...slotsLines,
    ``,
    `Please reply to this message or visit our nearest salon to reschedule.`,
    ``,
    `_Naturals — Unisex Hair & Style Salon_`
  ];

  return sendText(to, lines.join("\n"));
}

export async function sendFlowCompletionSummary(to, bodyText) {
  return sendText(to, bodyText);
}

export async function sendFeedbackRatingList(to, { customer_name, branch_name }) {
  const branch = String(branch_name || "Naturals").toUpperCase();
  return sendMessage({
    messaging_product: "whatsapp",
    to,
    type: "interactive",
    interactive: {
      type: "list",
      header: { type: "text", text: "Rate Your Experience ⭐" },
      body: {
        text: `Thank you for visiting *${branch}*, ${customer_name}! 💚\n\nHow would you rate your experience today?`
      },
      footer: { text: "Naturals" },
      action: {
        button: "Select Rating",
        sections: [
          {
            title: "Your Rating",
            rows: [
              { id: "rating_5", title: "⭐⭐⭐⭐⭐  Excellent", description: "5 Stars — Loved it!" },
              { id: "rating_4", title: "⭐⭐⭐⭐  Good", description: "4 Stars — Pretty good" },
              { id: "rating_3", title: "⭐⭐⭐  Average", description: "3 Stars — It was okay" },
              { id: "rating_2", title: "⭐⭐  Below Average", description: "2 Stars — Not great" },
              { id: "rating_1", title: "⭐  Poor", description: "1 Star — Very disappointed" }
            ]
          }
        ]
      }
    }
  });
}

export async function sendGoogleReviewPrompt(to, googleReviewUrl, reviewText = "") {
  const text = String(reviewText || "").trim();
  const lines = [];

  if (text) {
    lines.push(
      `✏️ *Your Review (tap & hold to copy):*`,
      ``,
      `_${text}_`,
      ``,
      `━━━━━━━━━━━━━━━━━━`,
      ``,
      `👇 *Open Google Reviews and paste your review:*`,
      googleReviewUrl,
      ``,
      `Your review has been copied. Please paste it into the Google review box and submit. 💚`
    );
  } else {
    lines.push(
      `🌟 *Share your experience on Google!*`,
      ``,
      `We're so glad you had a great experience at Naturals. Would you mind leaving a quick Google review? It helps other customers find us and motivates our team! 💚`,
      ``,
      `👉 *Leave a Google Review:*`,
      googleReviewUrl
    );
  }

  return sendMessage({
    messaging_product: "whatsapp",
    to,
    type: "text",
    text: { body: lines.join("\n") }
  });
}

export async function sendNegativeFeedbackPrompt(to) {
  return sendMessage({
    messaging_product: "whatsapp",
    to,
    type: "text",
    text: {
      body: `We're sorry your experience wasn't perfect. 😔\n\nYour feedback helps us improve. Please type what went wrong and we will make sure to address it personally.`
    }
  });
}

/** WhatsApp native location pin (opens in Maps). Requires lat/lng numbers. */
export async function sendLocationMessage(to, { latitude, longitude, name, address }) {
  const lat = Number(latitude);
  const lng = Number(longitude);
  if (Number.isNaN(lat) || Number.isNaN(lng)) {
    throw new Error("sendLocationMessage: invalid latitude/longitude");
  }
  return sendMessage({
    messaging_product: "whatsapp",
    to,
    type: "location",
    location: {
      latitude: lat,
      longitude: lng,
      name: name || undefined,
      address: address || undefined
    }
  });
}
