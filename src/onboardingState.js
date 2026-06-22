/** Per-user chat onboarding before opening the booking Flow. */
import { getOnboardingState, setOnboardingState } from "./database.js";

export const PHASE = {
  NONE: "none",
  AWAITING_ACTION: "awaiting_action",
  AWAITING_LOCATION_INPUT_PICK: "awaiting_location_input_pick",
  AWAITING_PIN_OR_LOCATION: "awaiting_pin_or_location",
  AWAITING_SALON_PICK: "awaiting_salon_pick",
  AWAITING_SALON_CONFIRM: "awaiting_salon_confirm",
  FLOW_SENT: "flow_sent",
  AWAITING_FEEDBACK_RATING: "awaiting_feedback_rating",
  AWAITING_FEEDBACK_TEXT: "awaiting_feedback_text"
};

export function getOnboarding(from) {
  return getOnboardingState(from) || { phase: PHASE.NONE };
}

export function setOnboarding(from, patch) {
  const cur = getOnboarding(from);
  setOnboardingState(from, { ...cur, ...patch });
}

export function isGreeting(text) {
  const t = String(text || "")
    .trim()
    .toLowerCase();
  if (t.length > 40) return false;
  return /^(hi|hello|hey|hii|hlo|namaste|good\s+(morning|afternoon|evening)|start)\b/i.test(
    t
  );
}

export function looksLikePincode(text) {
  return /^\d{6}$/.test(String(text || "").trim());
}

export function looksLikeLocationSearchText(text) {
  const t = String(text || "").trim();
  if (!t || t.length < 3) return false;
  if (looksLikePincode(t)) return true;
  return /^[a-zA-Z0-9\s.-]+$/.test(t);
}
