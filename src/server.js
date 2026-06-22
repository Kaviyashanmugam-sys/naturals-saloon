import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { config, validateConfig } from "./config.js";
import {
  initDatabase,
  insertBooking,
  insertFeedback,
  listBookingsByMobile,
  listAppointments,
  listBookings,
  listUsers,
  setFlowSession,
  setFeedbackSession,
  getFeedbackSession,
  clearFeedbackSession
} from "./database.js";
import {
  createPendingBooking,
  formatServicesPrettyFromBlob,
  getNearestSalons,
  getSalonByIdFromCache,
  getStylistsByGender
} from "./bookingEngine.js";
import { createAppointment } from "./gtlApi.js";
import { decryptFlowRequest, encryptFlowResponse, loadFlowPrivateKeyPem } from "./flowCrypto.js";
import { handleFlowDataExchange } from "./flowHandlers.js";
import {
  extractGoogleReviewUrl,
  formatBookingSummaryFromFlow,
  formatFeedbackThankYou,
  isFeedbackFlowPayload,
  parseNfmReplyPayload
} from "./flowWebhook.js";
import {
  getOnboarding,
  isGreeting,
  looksLikeLocationSearchText,
  PHASE,
  setOnboarding
} from "./onboardingState.js";
import {
  sendBookingConfirmed,
  sendBookingRejected,
  sendBookingFlow,
  sendFeedbackFlow,
  sendFeedbackRatingList,
  sendFlowCompletionSummary,
  sendGoogleReviewPrompt,
  sendImage,
  sendLocationInputOptionsList,
  sendLocationMessage,
  sendLocationRequestMessage,
  sendMainMenuList,
  sendNegativeFeedbackPrompt,
  sendPromptWithBackButton,
  sendSalonListMessage,
  sendWelcomeActionButtons,
  sendText
} from "./whatsapp.js";
import { isAlreadyProcessedInbound } from "./webhookDedupe.js";
import { logWebhook, logWebhookError } from "./webhookLog.js";
import appointmentConfirmationRouter from "./appointmentConfirmationApi.js";
import feedbackRequestRouter from "./feedbackRequestApi.js";

validateConfig();
const dbPath = await initDatabase();

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json({ limit: "2mb" }));
app.use("/static", express.static(path.join(__dirname, "..", "public")));

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "green-trends-whatsapp-bot" });
});

app.use(appointmentConfirmationRouter);
app.use(feedbackRequestRouter);



/** Flow submit completion — do NOT run welcome again (was misclassified as interactive). */
async function handleFlowCompletion(msg) {
  const from = msg.from;
  const payload = parseNfmReplyPayload(msg);
  if (!payload) {
    logWebhook("flow_response", "could not parse nfm_reply.response_json");
    return;
  }

  logWebhook("flow_response", `parsed keys=${Object.keys(payload).join(",")}`);

  if (isFeedbackFlowPayload(payload)) {
    try {
      const reviewText = String(payload.review_text || "").trim();
      const googleReviewUrl = extractGoogleReviewUrl(payload);

      await insertFeedback({
        mobile: from,
        rating: 0,
        customer_name: "",
        branch_name: "",
        appointment_id: null,
        feedback_text: reviewText,
        staff_performance: payload.staff_performance || "",
        amenities_rating: payload.amenities_rating || "",
        overall_experience: payload.overall_experience || "",
        google_review_shown: !!googleReviewUrl
      });
      logWebhook("db", "feedback saved from flow completion");

      await sendText(from, formatFeedbackThankYou(payload));
      logWebhook("send", "feedback thank-you OK");

      if (googleReviewUrl) {
        await sendGoogleReviewPrompt(from, googleReviewUrl, reviewText);
        logWebhook("send", "google review prompt OK");
      }
    } catch (e) {
      logWebhookError("send feedback thank-you", e);
    }
    return;
  }

  const summary = formatBookingSummaryFromFlow(payload);
  let addToCalendarSucceeded = false;

  // Fallback persistence: ensures bookings are stored even if Flow completion
  // reaches webhook but `/flow` complete-action did not persist.
  try {
    const servicePretty =
      payload.service_item_pretty ||
      formatServicesPrettyFromBlob(payload.service_blob) ||
      payload.service_item ||
      payload.service_category ||
      "";

    const fallbackBooking = createPendingBooking({
      fullName: payload.customer_name || "",
      mobile: normalizeMobileForApi(payload.customer_mobile || from || ""),
      email: payload.customer_email || "",
      salonId: payload.salon_id || "",
      salonName: payload.salon_name || "",
      mapsUrl: payload.maps_url || "",
      gender: payload.gender || "",
      serviceCategory: payload.service_category || "Multiple",
      serviceItem: servicePretty,
      serviceBlob: payload.service_blob || "",
      date: payload.booking_date || "",
      stylistName: (!payload.stylist_id || payload.stylist_id === "0" || payload.stylist_id === "none" || payload.stylist_id === "-") ? "-" : (payload.stylist_name || payload.stylist_id || "-"),
      timeSlot: payload.slot_id || ""
    });

    await insertBooking(fallbackBooking);
    logWebhook("db", `booking persisted from nfm_reply id=${fallbackBooking.bookingId}`);

    const addToCalendarPayload = {
      storeid: Number(payload.salon_id || 0),
      orgid: config.gtlOrgId,
      name: sanitizeNameForApi(payload.customer_name || ""),
      email: payload.customer_email || "",
      mobile: normalizeMobileForApi(payload.customer_mobile || from || ""),
      genderid: String(payload.gender || "").toLowerCase() === "male" ? 1 : 2,
      notes: "Booked via WhatsApp",
      service: servicePretty,
      selectedDate: payload.booking_date || "",
      time: normalizeTimeForApi(payload.slot_id),
      id: (!payload.stylist_id || payload.stylist_id === "none" || payload.stylist_id === "0" || payload.stylist_id === "-") ? "" : String(payload.stylist_id || "")
    };
    logWebhook("api", `addToCalendar request ${JSON.stringify(addToCalendarPayload)}`);
    const addToCalendarResp = await createAppointment(addToCalendarPayload);
    logWebhook("api", `addToCalendar success ${JSON.stringify(addToCalendarResp)}`);
    addToCalendarSucceeded = true;
  } catch (persistErr) {
    logWebhookError("persist booking from nfm_reply", persistErr);
  }

  if (addToCalendarSucceeded) {
    try {
      await sendFlowCompletionSummary(from, summary);
      logWebhook("send", "flow completion summary OK");
    } catch (e) {
      logWebhookError("send flow completion summary", e);
    }
  } else {
    try {
      await sendText(
        from,
        "We received your request, but booking confirmation is pending. Our team will get back to you shortly."
      );
      logWebhook("send", "booking pending message sent");
    } catch (e) {
      logWebhookError("send booking pending message", e);
    }
  }

  const salon = getSalonByIdFromCache(payload.salon_id);
  if (addToCalendarSucceeded && salon && salon.lat != null && salon.lng != null) {
    try {
      await sendLocationMessage(from, {
        latitude: salon.lat,
        longitude: salon.lng,
        name: salon.name,
        address: `${salon.area}, ${salon.city}`.trim()
      });
      logWebhook("send", "location pin OK");
      try {
        await sendText(
          from,
          "💚 Thank you for choosing Naturals — we truly appreciate your trust. We cannot wait to see you at the salon! ✨"
        );
        logWebhook("send", "post-location thank you OK");
      } catch (tyErr) {
        logWebhookError("send thank you after location", tyErr);
      }
    } catch (e) {
      logWebhookError("send location pin", e);
    }
  }
}

function normalizeTimeForApi(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const firstPart = raw.split("-")[0].trim();
  const m = firstPart.match(/^(\d{1,2}):(\d{2})(?:\s*([AP]M))?$/i);
  if (!m) return firstPart;
  let hh = Number(m[1]);
  const mm = String(m[2]).padStart(2, "0");
  const meridiem = (m[3] || "").toUpperCase();
  if (meridiem) {
    if (meridiem === "PM" && hh !== 12) hh += 12;
    if (meridiem === "AM" && hh === 12) hh = 0;
  }
  return `${String(hh).padStart(2, "0")}:${mm}`;
}

function normalizeMobileForApi(value) {
  const digits = String(value || "").replace(/\D+/g, "");
  if (digits.length === 10) return `91${digits}`;
  if (digits.length === 11 && digits.startsWith("0")) return `91${digits.slice(1)}`;
  if (digits.length === 12 && digits.startsWith("91")) return digits;
  return digits;
}

function sanitizeNameForApi(value) {
  const cleaned = String(value || "")
    .replace(/[^\p{L}\p{M}\p{N}\s.'-]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || "Customer";
}

/** Hi → welcome image first, then native location request + pincode hint (Flow opens after list pick). */
async function sendWelcomeImageAndAskLocation(msg) {
  const from = msg.from;
  if (!from) return;

  logWebhook("welcome", `greeting from=${from} id=${msg.id || "n/a"}`);

  const caption = `✨ *Welcome to Naturals*

Happiness!
Like never before!
It's unbelievable!

Pay ₹2,000 Today. Get ₹30,000 Services.
For Your Entire Family. Across 1000+ Naturals Salons.

Customer First`;

  try {
    await sendImage(from, config.welcomeImageUrl, caption);
    logWebhook("send", "welcome image OK");
  } catch (imgErr) {
    logWebhookError("welcome image (set PUBLIC_BASE_URL or WELCOME_IMAGE_URL)", imgErr);
  }

  // Keep a deterministic UX order: welcome first, then actions after a short gap.
  await delay(2000);

  try {
    await sendWelcomeActionButtons(from);
    logWebhook("send", "welcome action buttons OK");
  } catch (e) {
    logWebhookError("welcome action buttons", e);
    await sendText(from, "Reply with *book* to start booking.");
  }

  setOnboarding(from, { phase: PHASE.AWAITING_ACTION });
}

async function startBookingLocationFlow(from) {
  await delay(300);
  try {
    await sendLocationInputOptionsList(from);
    logWebhook("send", "location input options list OK");
  } catch (e) {
    logWebhookError("location_input_options_list", e);
    await sendText(
      from,
      "Choose one: *Live Location* or *Area* to find nearby salons."
    );
  }

  setOnboarding(from, { phase: PHASE.AWAITING_LOCATION_INPUT_PICK, location_input_mode: "" });
}

function cleanProfileName(value) {
  const v = String(value || "").trim();
  if (!v) return "";
  return v.replace(/\s+/g, " ").slice(0, 120);
}

function normalizeMobileForFlow(from) {
  return String(from || "").replace(/\D+/g, "");
}

async function getKnownCustomerName(from) {
  const fromOnboarding = cleanProfileName(getOnboarding(from).customer_name || "");
  if (fromOnboarding) return fromOnboarding;

  const recent = await listBookingsByMobile(from, 1);
  const fromBooking = cleanProfileName(recent?.[0]?.fullName || "");
  return fromBooking;
}

async function presentNearbySalonsOrRetry(from, nearbySalons) {
  if (!nearbySalons || nearbySalons.length === 0) {
    await sendPromptWithBackButton(from, "🔍 No Naturals salons found for that location.\n\nPlease type a correct *city, area name or pincode* (example: Chennai / T Nagar / 600017).\n\nOr tap below to choose a different location method.");
    setOnboarding(from, { phase: PHASE.AWAITING_PIN_OR_LOCATION, location_input_mode: "city" });
    return;
  }

  try {
    await sendSalonListMessage(from, nearbySalons);
    logWebhook("send", "salon list interactive OK");
    setOnboarding(from, { phase: PHASE.AWAITING_SALON_PICK, nearby_salons: nearbySalons });
  } catch (e) {
    logWebhookError("sendSalonListMessage", e);
    await sendText(from, "⚠️ Could not show the salon list. Please try again in a moment.");
  }
}

async function trySendFeedbackRating(from) {
  const flowToken = `fb_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
  try {
    await sendFeedbackFlow(from, flowToken, "");
    logWebhook("send", "feedback flow OK");
  } catch (e) {
    console.error("[feedback_flow_error]", e?.message || e);
    logWebhookError("sendFeedbackFlow", e);
    await sendText(from, `❌ Feedback flow error: ${e?.message || "unknown"}`);
  }
}

async function handleChangeSalon(from) {
  const { nearby_salons } = getOnboarding(from);
  if (nearby_salons && nearby_salons.length > 0) {
    try {
      await sendSalonListMessage(
        from,
        nearby_salons,
        "Change Salon ✨",
        "Pick a different salon below.\n\nOr type a *city / area / pincode* to search in a new location."
      );
      logWebhook("send", "change salon list OK");
      setOnboarding(from, { phase: PHASE.AWAITING_SALON_PICK });
    } catch (e) {
      logWebhookError("handleChangeSalon sendSalonListMessage", e);
      await startBookingLocationFlow(from);
    }
  } else {
    await startBookingLocationFlow(from);
  }
}

async function sendBookingFlowAfterSalonSelection(from, salon) {
  if (!config.flowIdBookAppointment || config.flowIdBookAppointment.includes("replace")) {
    logWebhook(
      "send flow",
      "SKIPPED — set FLOW_ID_BOOK_APPOINTMENT in .env to your published Flow ID (WhatsApp Manager → Flows)."
    );
    await sendText(
      from,
      "⚠️ Booking Flow is not configured yet. Ask your admin to set FLOW_ID_BOOK_APPOINTMENT."
    );
    return;
  }

  const addressLine = salon.addressLine1 || [salon.area, salon.city, salon.pincode].filter(Boolean).join(" · ");
  const customerName = await getKnownCustomerName(from);
  const customerMobile = normalizeMobileForFlow(from);
  const flowToken = `token_${Date.now()}_${Math.floor(Math.random() * 10000)}`;

  let stylistList = [];
  try {
    stylistList = await getStylistsByGender(salon.id, "any");
  } catch (e) {
    logWebhookError("fetchStylists for initial flow data", e);
  }
  const stylistOptions = [
    { id: "0", title: "No Preference" },
    ...stylistList.map((s) => ({ id: s.id, title: s.displayTitle || s.name }))
  ];
  logWebhook("stylist_options", `count=${stylistOptions.length} first=${JSON.stringify(stylistOptions[0])}`);

  const initialFlowData = {
    customer_name: customerName,
    customer_mobile: customerMobile,
    salon_id: salon.id,
    salon_name: salon.name,
    salon_address_line: addressLine,
    salon_phone: salon.phone || "",
    maps_url: salon.mapsUrl,
    salon_latitude: String(salon.lat),
    salon_longitude: String(salon.lng),
    stylist_options: stylistOptions
  };

  // Keep a server-side fallback so ENTRY can prefill even if init payload omits data.
  setFlowSession(flowToken, initialFlowData);

  await sendBookingFlow(from, initialFlowData, flowToken);
  logWebhook("send", "interactive Flow OK (salon pre-selected)");
  setOnboarding(from, { phase: PHASE.FLOW_SENT });
}

async function handleSalonListReply(msg) {
  const from = msg.from;
  if (!from) return;

  const selectionIdEarly = msg.interactive?.list_reply?.id || "";
  if (selectionIdEarly.startsWith("menu_")) {
    if (selectionIdEarly === "menu_restart") {
      await sendWelcomeImageAndAskLocation(msg);
    } else if (selectionIdEarly === "menu_change_salon") {
      await handleChangeSalon(from);
    } else if (selectionIdEarly === "menu_change_location") {
      await startBookingLocationFlow(from);
    } else {
      await startBookingLocationFlow(from);
    }
    return;
  }

  const { phase } = getOnboarding(from);
  if (phase === PHASE.AWAITING_LOCATION_INPUT_PICK) {
    const selectionId = msg.interactive?.list_reply?.id;
    if (!selectionId) return;

    if (selectionId === "loc_mode_live") {
      try {
        await sendLocationRequestMessage(
          from,
          "📍 Great choice. Tap *Send location* below to share your current location."
        );
      } catch (e) {
        logWebhookError("location_request_message after mode pick", e);
        await sendText(
          from,
          "📍 Tap 📎 → *Location* → send your current location so we can list nearby salons."
        );
      }
      await sendPromptWithBackButton(from, "Or tap below if you'd like to choose a different location method.");
      setOnboarding(from, { phase: PHASE.AWAITING_PIN_OR_LOCATION, location_input_mode: "live" });
      return;
    }

    if (selectionId === "loc_mode_pincode" || selectionId === "loc_mode_city") {
      await sendPromptWithBackButton(from, "📍 Please type your *city, area name or pincode* (example: Chennai / T Nagar / 600017).\n\nOr tap below to choose a different location method.");
      setOnboarding(from, { phase: PHASE.AWAITING_PIN_OR_LOCATION, location_input_mode: "city" });
      return;
    }

    await sendText(from, "Please choose a valid location option from the list.");
    await startBookingLocationFlow(from);
    return;
  }

  if (phase === PHASE.AWAITING_FEEDBACK_RATING) {
    const selectionId = msg.interactive?.list_reply?.id || "";
    const ratingMatch = selectionId.match(/^rating_(\d)$/);
    if (!ratingMatch) return;
    const rating = Number(ratingMatch[1]);
    const fbSession = getFeedbackSession(from);
    logWebhook("feedback_rating", `from=${from} rating=${rating}`);

    await insertFeedback({
      mobile: from,
      rating,
      customer_name: fbSession?.customer_name || "",
      branch_name: fbSession?.branch_name || "",
      appointment_id: fbSession?.appointment_id || null,
      feedback_text: "",
      google_review_shown: rating >= 4
    });

    if (rating >= 4) {
      const reviewUrl = fbSession?.google_review_url;
      if (reviewUrl) {
        await sendGoogleReviewPrompt(from, reviewUrl);
      } else {
        await sendText(from, "🌟 *Thank you for your wonderful feedback!*\n\nWe're delighted you had a great experience at Naturals. See you again soon! 💚");
      }
      clearFeedbackSession(from);
      setOnboarding(from, { phase: PHASE.AWAITING_ACTION });
    } else {
      setOnboarding(from, { phase: PHASE.AWAITING_FEEDBACK_TEXT });
      await sendNegativeFeedbackPrompt(from);
    }
    return;
  }

  if (phase !== PHASE.AWAITING_SALON_PICK) {
    logWebhook("list_reply", `ignored — phase=${phase}`);
    return;
  }

  const salonId = msg.interactive?.list_reply?.id;
  if (!salonId) return;

  const salon = getOnboarding(from).nearby_salons?.find((s) => String(s.id) === String(salonId));
  if (!salon) {
    await sendText(from, "❗ That option is no longer valid. Please try your location again.");
    await sendLocationInputOptionsList(from);
    setOnboarding(from, { phase: PHASE.AWAITING_LOCATION_INPUT_PICK, location_input_mode: "" });
    return;
  }

  logWebhook("list_reply", `picked salon=${salonId}`);

  try {
    await sendBookingFlowAfterSalonSelection(from, salon);
  } catch (e) {
    logWebhookError("sendBookingFlowAfterSalonSelection", e);
  }
}

async function handleInboundLocation(msg) {
  const from = msg.from;
  if (!from) return;
  const { phase } = getOnboarding(from);
  if (phase !== PHASE.AWAITING_PIN_OR_LOCATION && phase !== PHASE.AWAITING_SALON_PICK) {
    logWebhook("location", `ignored — phase=${phase}`);
    return;
  }

  const lat = Number(msg.location?.latitude);
  const lng = Number(msg.location?.longitude);
  if (Number.isNaN(lat) || Number.isNaN(lng)) {
    await sendText(from, "❗ Could not read that location. Please try again or send a 6-digit pincode.");
    return;
  }

  const nearby = await getNearestSalons({ lat, lng });
  logWebhook("location", `lat=${lat} lng=${lng} salons=${nearby.length}`);
  await presentNearbySalonsOrRetry(from, nearby);
}

async function handleInboundText(msg) {
  const from = msg.from;
  if (!from) return;

  const text = msg.text?.body ?? "";
  const norm = text.trim().toLowerCase();
  const { phase } = getOnboarding(from);

  if (phase === PHASE.AWAITING_FEEDBACK_TEXT) {
    const fbSession = getFeedbackSession(from);
    await insertFeedback({
      mobile: from,
      rating: fbSession?.rating || 0,
      customer_name: fbSession?.customer_name || "",
      branch_name: fbSession?.branch_name || "",
      appointment_id: fbSession?.appointment_id || null,
      feedback_text: text.trim(),
      google_review_shown: false
    });
    clearFeedbackSession(from);
    setOnboarding(from, { phase: PHASE.AWAITING_ACTION });
    await sendText(from, "Thank you for letting us know. 💚\n\nWe take every feedback seriously and will use it to improve your next visit. We hope to serve you better soon!");
    return;
  }

  if (norm.includes("feedback")) {
    await trySendFeedbackRating(from);
    return;
  }

  if (isGreeting(text)) {
    await sendWelcomeImageAndAskLocation(msg);
    return;
  }

  if (phase === PHASE.AWAITING_ACTION) {
    if (norm.includes("book")) {
      await startBookingLocationFlow(from);
      return;
    }
    await sendMainMenuList(from);
    return;
  }

  if (phase === PHASE.AWAITING_LOCATION_INPUT_PICK) {
    await sendText(from, "👆 Please pick one option from the list: *Live Location* or *Area*.");
    await startBookingLocationFlow(from);
    return;
  }

  if (phase === PHASE.AWAITING_SALON_PICK) {
    if (looksLikeLocationSearchText(text)) {
      const nearby = await getNearestSalons({ searchText: text.trim() });
      logWebhook("search_refresh", `${text.trim()} → ${nearby.length} salons`);
      await presentNearbySalonsOrRetry(from, nearby);
      return;
    }
    await sendText(
      from,
      "👆 Tap *Choose salon* in the menu above and pick a row — or send a new *6-digit pincode* to refresh the list."
    );
    return;
  }

  if (phase === PHASE.AWAITING_PIN_OR_LOCATION) {
    const locationMode = String(getOnboarding(from).location_input_mode || "");
    if (locationMode === "pincode") {
      if (!/^\d{6}$/.test(text.trim())) {
        await sendPromptWithBackButton(from, "📌 Please enter a valid *6-digit pincode* (example: 600017).\n\nOr tap below to choose a different location method.");
        return;
      }
    }
    if (locationMode === "city") {
      const cityText = text.trim();
      if (!cityText) {
        await sendPromptWithBackButton(from, "🏙️ Please enter a *city/area name* (example: Chennai / Anna Nagar).\n\nOr tap below to choose a different location method.");
        return;
      }
      // 6-digit pincodes are also valid — fall through to location search below
    }
    if (looksLikeLocationSearchText(text)) {
      const searchInput = text.trim();
      const isPincode = /^\d{6}$/.test(searchInput);
      const nearby = await getNearestSalons({ searchText: searchInput });
      logWebhook(isPincode ? "pincode_search" : "search", `"${searchInput}" → ${nearby.length} salons`);
      await presentNearbySalonsOrRetry(from, nearby);
      return;
    }
    await sendPromptWithBackButton(from, "📌 Please send a valid *pincode* or *city name* (example: 600017 / Chennai).\n\nOr tap below to choose a different location method.");
    return;
  }

  if (phase === PHASE.NONE) {
    await sendMainMenuList(from);
    return;
  }

  if (phase === PHASE.FLOW_SENT) {
    setOnboarding(from, { phase: PHASE.AWAITING_ACTION });
    await sendMainMenuList(from);
    return;
  }

  await sendMainMenuList(from);
}

async function handleActionButtonReply(msg) {
  const from = msg.from;
  if (!from) return;
  const btnId = msg.interactive?.button_reply?.id;
  if (!btnId) return;

  if (btnId === "action_book" || btnId === "loc_change_option") {
    await startBookingLocationFlow(from);
    return;
  }

  if (btnId === "change_salon") {
    await handleChangeSalon(from);
    return;
  }

  if (btnId === "confirm_salon") {
    const salon = getOnboarding(from).selected_salon;
    if (!salon) {
      await sendText(from, "⚠️ Session expired. Please select a salon again.");
      await startBookingLocationFlow(from);
      return;
    }
    try {
      await sendBookingFlowAfterSalonSelection(from, salon);
    } catch (e) {
      logWebhookError("sendBookingFlow after confirm", e);
    }
  }
}

async function dispatchInboundMessage(msg) {
  const from = msg.from;
  if (!from) return;
  const waProfileName = cleanProfileName(msg.__profile_name || "");
  if (waProfileName) {
    setOnboarding(from, { customer_name: waProfileName });
  }

  if (msg.type === "interactive") {
    const iType = msg.interactive?.type;
    if (iType === "nfm_reply") {
      await handleFlowCompletion(msg);
      return;
    }
    if (iType === "list_reply") {
      await handleSalonListReply(msg);
      return;
    }
    if (iType === "button_reply") {
      await handleActionButtonReply(msg);
      return;
    }
    logWebhook("inbound", `interactive ignored type=${iType || "unknown"} (not a Flow response)`);
    return;
  }

  if (msg.type === "location") {
    await handleInboundLocation(msg);
    return;
  }

  if (msg.type === "text") {
    await handleInboundText(msg);
    return;
  }

  logWebhook("inbound", `ignored type=${msg.type}`);
}

app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === config.verifyToken) {
    console.log("[webhook] Facebook verification successful");
    return res.status(200).send(challenge);
  }

  console.warn("[webhook] Facebook verification failed — token mismatch or missing mode");
  return res.sendStatus(403);
});

app.post("/webhook", (req, res) => {
  try {
    const entries = req.body?.entry || [];

    // Acknowledge immediately so Meta does not retry (avoids duplicate outbound messages).
    res.sendStatus(200);

    setImmediate(() => {
      (async () => {
        for (const entry of entries) {
          const changes = entry?.changes || [];
          for (const change of changes) {
            if (change.field !== "messages") continue;
            const messages = change.value?.messages || [];
            const contacts = change.value?.contacts || [];
            const nameByWaId = new Map(
              contacts.map((c) => [String(c?.wa_id || ""), c?.profile?.name || ""])
            );

            for (const msg of messages) {
              const profileName = nameByWaId.get(String(msg?.from || ""));
              if (profileName) {
                msg.__profile_name = profileName;
              }
              if (isAlreadyProcessedInbound(msg)) {
                logWebhook("dedupe", `skip duplicate id=${msg.id || msg.timestamp}`);
                continue;
              }
              try {
                await dispatchInboundMessage(msg);
              } catch (err) {
                logWebhookError("dispatchInboundMessage", err);
              }
            }
          }
        }
      })();
    });
  } catch (error) {
    console.error("Webhook error:", error.message);
    if (!res.headersSent) {
      res.sendStatus(500);
    }
  }
});

/**
 * Production Flow endpoint: Meta sends encrypted JSON (see FLOW_PUBLIC_KEY_SETUP.md).
 * Configure this exact HTTPS URL in WhatsApp Manager → Flow → Endpoint (no trailing slash required).
 */
async function handleEncryptedFlow(req, res) {
  const privateKeyPem = loadFlowPrivateKeyPem();
  if (!privateKeyPem) {
    console.error("FLOW_PRIVATE_KEY_PATH or FLOW_PRIVATE_KEY is not set");
    return res.status(503).type("text/plain").send("flow_private_key_missing");
  }

  try {
    const { decryptedBody, aesKeyBuffer, initialVectorBuffer } = decryptFlowRequest(
      req.body,
      privateKeyPem
    );
    console.log("[flow] decrypted request", {
      action: decryptedBody?.action,
      screen: decryptedBody?.screen || "init",
      flow_token: decryptedBody?.flow_token ? "present" : "missing"
    });
    const response = await handleFlowDataExchange(decryptedBody);
    const encrypted = encryptFlowResponse(response, aesKeyBuffer, initialVectorBuffer);
    return res.status(200).type("text/plain").send(encrypted);
  } catch (error) {
    console.error("Flow /flow error:", error.message);
    if (error?.stack) {
      console.error(error.stack);
    }
    return res.status(421).type("text/plain").send("decryption_failed");
  }
}

app.get("/flow", (_req, res) => {
  res.status(200).json({
    ok: true,
    service: "whatsapp-flow-endpoint",
    post: "Send encrypted Flow requests (application/json) to this URL with POST."
  });
});

app.post("/flow", handleEncryptedFlow);
app.post("/flow/", handleEncryptedFlow);

/** Local / dev only: plaintext JSON (do not expose publicly). */
app.post("/flow/data-exchange", async (req, res) => {
  if (process.env.FLOW_ALLOW_PLAINTEXT !== "true") {
    return res.status(404).json({ error: "not_found" });
  }
  try {
    const response = await handleFlowDataExchange(req.body);
    return res.status(200).json(response);
  } catch (error) {
    console.error("Flow data exchange error:", error.message);
    return res.status(500).json({ error: "flow_data_exchange_failed" });
  }
});

// Mock manager approval callback endpoint.
app.post("/internal/mock-approve", async (req, res) => {
  const { to, booking } = req.body || {};
  if (!to || !booking) {
    return res.status(400).json({ error: "to and booking are required" });
  }

  try {
    await sendBookingConfirmed(to, booking);
    return res.json({ ok: true, status: "CONFIRMED" });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
});

app.get("/internal/bookings", async (_req, res) => {
  try {
    const bookings = await listBookings();
    return res.json({ ok: true, total: bookings.length, bookings });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
});

app.get("/internal/users", async (_req, res) => {
  try {
    const users = await listUsers();
    return res.json({ ok: true, total: users.length, users });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
});

app.get("/internal/appointments", async (_req, res) => {
  try {
    const appointments = await listAppointments();
    return res.json({ ok: true, total: appointments.length, appointments });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
});

app.post("/api/booking-status", async (req, res) => {
  const {
    mobile, status,
    customerName, salonName, address, services, date, timeSlot, stylistName, mapsUrl, bookingId,
    reason, alternateSlots
  } = req.body || {};

  if (!mobile || !status) {
    return res.status(400).json({ ok: false, error: "mobile and status are required" });
  }

  const upper = String(status).toUpperCase();
  if (upper !== "CONFIRMED" && upper !== "REJECTED") {
    return res.status(400).json({ ok: false, error: "status must be CONFIRMED or REJECTED" });
  }

  const digits = String(mobile).replace(/\D+/g, "");
  const to = digits.length === 10 ? `91${digits}` : digits;

  try {
    if (upper === "CONFIRMED") {
      await sendBookingConfirmed(to, { customerName, salonName, address, services, date, timeSlot, stylistName, mapsUrl, bookingId });
    } else {
      await sendBookingRejected(to, customerName, reason || "slot unavailable", alternateSlots || []);
    }
    return res.json({ ok: true, status: upper });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
});

app.listen(config.port, "localhost", () => {
  console.log(`Naturals WhatsApp bot listening on http://0.0.0.0:${config.port}`);
  console.log(`Database: ${dbPath}`);
  console.log(`Flow endpoint: POST http://localhost:${config.port}/flow (use same path behind ngrok)`);
  console.log(
    `Welcome image URL resolved to: ${config.welcomeImageUrl} (set PUBLIC_BASE_URL=https://your-ngrok-host for /static/green-trends-welcome.png)`
  );
});
