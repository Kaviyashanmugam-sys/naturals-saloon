import dotenv from "dotenv";

dotenv.config();

function resolveWelcomeImageUrl() {
  if (process.env.WELCOME_IMAGE_URL) {6
    return process.env.WELCOME_IMAGE_URL;
  }
  const base = (process.env.PUBLIC_BASE_URL || "").replace(/\/$/, "");
  if (base) {
    return `${base}/static/green-trends-welcome.png`;
  }
  return "https://salons.naturals.in/files/offer-images/2466885/home_page-2791_1769528764_Signatureoffer.jpg";
}

export const config = {
  port: process.env.PORT || 3000,
  verifyToken: process.env.VERIFY_TOKEN || "naturals@123",
  whatsappToken: process.env.WHATSAPP_TOKEN || "EAAdgUfllkyMBRcnyPu1Sku5PmgPt5XLFpEKo5ZBdJWhZCQ5WIIZCjT4aQpBqHUXPsHdqzbuHUIHlmK8NobG9BAOZAtuRZBLXoyNLZAVJ8sqpRQW7DOeak42bxzPSzs8IZBJ5EM2xTUoH0oZBXv59yn3zOPfBpyp8vstRaKjpbZCSEkVc00YjUkpjFghtGBUczuAZDZD",
  phoneNumberId: process.env.PHONE_NUMBER_ID || "1125291247329294",
  flowIdBookAppointment: process.env.FLOW_ID_BOOK_APPOINTMENT || "1605629260520560",
  /** Publish `whatsapp-flows/green-trends-feedback-flow.json` and set this Flow ID. */
  flowIdFeedback: process.env.FLOW_ID_FEEDBACK || "1306289881451102",
  appSecret: process.env.APP_SECRET || "",
  gtlApiBaseUrl: process.env.GTL_API_BASE_URL || "https://ntlivewebapi.innosmarti.com",
  gtlOrgId: Number(process.env.GTL_ORG_ID || 1001),
  gtlBrandId: Number(process.env.GTL_BRAND_ID || 1),
  gtlApiCookie: process.env.GTL_API_COOKIE || "",
  gtlApiAuth: process.env.GTL_API_AUTH || "Basic SW5ub3NtYXJ0aTpITlRlbEc0ZTVETU1hMG1YZkJEX0hB",
  /** Set PUBLIC_BASE_URL (e.g. https://xxx.ngrok-free.app) so /static/green-trends-welcome.png works, or set WELCOME_IMAGE_URL. */
  get welcomeImageUrl() {
    return resolveWelcomeImageUrl();
  }
};

export function validateConfig() {
  const required = [
    "verifyToken",
    "whatsappToken",
    "phoneNumberId",
    "flowIdBookAppointment"
  ];

  const missing = required.filter((key) => !config[key]);
  if (missing.length > 0) {
    // Non-fatal for local development, but warn clearly.
    console.warn(
      `[WARN] Missing env keys: ${missing.join(", ")}. Some bot features will fail until configured.`
    );
  }
}
