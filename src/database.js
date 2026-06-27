// src/database.js
// Naturals Salon — MongoDB + In-Memory Hybrid Database

import mongoose from "mongoose";

// ─── CONNECTION ──────────────────────────────────────────────
let isMongoConnected = false;

async function connectMongo() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.log("[db] MONGODB_URI not set — using in-memory");
    return false;
  }
  try {
    await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 8000,
      connectTimeoutMS: 8000,
      dbName: "naturals"
    });
    isMongoConnected = true;
    console.log("[db] ✅ MongoDB connected:", mongoose.connection.name);
    return true;
  } catch (e) {
    console.warn("[db] ⚠️ MongoDB connection failed, using in-memory:", e.message);
    return false;
  }
}

// ─── MONGOOSE SCHEMAS ────────────────────────────────────────
const BookingSchema = new mongoose.Schema({
  bookingId:       { type: String, unique: true, index: true },
  status:          { type: String, default: "PENDING_APPROVAL" },
  fullName:        String,
  mobile:          { type: String, index: true },
  email:           String,
  salonId:         String,
  salonName:       String,
  mapsUrl:         String,
  gender:          String,
  serviceCategory: String,
  serviceItem:     String,
  serviceBlob:     String,
  date:            { type: String, index: true },
  stylistName:     String,
  timeSlot:        String,
  isWalkIn:        { type: Boolean, default: false },
  createdAt:       { type: String },
  updatedAt:       { type: String }
}, { timestamps: false });

const OnboardingSchema = new mongoose.Schema({
  phoneNumber: { type: String, unique: true, index: true },
  state:       mongoose.Schema.Types.Mixed,
  updatedAt:   String
});

const FlowSessionSchema = new mongoose.Schema({
  flowToken: { type: String, unique: true, index: true },
  session:   mongoose.Schema.Types.Mixed,
  updatedAt: String
});

const FeedbackSchema = new mongoose.Schema({
  mobile:              String,
  rating:              Number,
  customer_name:       String,
  branch_name:         String,
  appointment_id:      mongoose.Schema.Types.Mixed,
  feedback_text:       String,
  staff_performance:   String,
  amenities_rating:    String,
  overall_experience:  String,
  google_review_shown: Boolean,
  savedAt:             String
});

const FeedbackSessionSchema = new mongoose.Schema({
  mobile:    { type: String, unique: true, index: true },
  session:   mongoose.Schema.Types.Mixed,
  updatedAt: String
});

const SalonRatingSchema = new mongoose.Schema({
  salonId:     { type: String, unique: true, index: true },
  rating:      Number,
  reviewCount: Number,
  updatedAt:   String
});

const NotificationLogSchema = new mongoose.Schema({
  data:    mongoose.Schema.Types.Mixed,
  savedAt: String
});

// ─── MODELS ──────────────────────────────────────────────────
let BookingModel, OnboardingModel, FlowSessionModel,
    FeedbackModel, FeedbackSessionModel, SalonRatingModel, NotifLogModel;

function initModels() {
  BookingModel         = mongoose.models.Booking         || mongoose.model("Booking",         BookingSchema);
  OnboardingModel      = mongoose.models.Onboarding      || mongoose.model("Onboarding",      OnboardingSchema);
  FlowSessionModel     = mongoose.models.FlowSession     || mongoose.model("FlowSession",     FlowSessionSchema);
  FeedbackModel        = mongoose.models.Feedback        || mongoose.model("Feedback",        FeedbackSchema);
  FeedbackSessionModel = mongoose.models.FeedbackSession || mongoose.model("FeedbackSession", FeedbackSessionSchema);
  SalonRatingModel     = mongoose.models.SalonRating     || mongoose.model("SalonRating",     SalonRatingSchema);
  NotifLogModel        = mongoose.models.NotificationLog || mongoose.model("NotificationLog", NotificationLogSchema);
}

// ─── IN-MEMORY FALLBACK ──────────────────────────────────────
const EMPTY_STATE = {
  onboarding: {}, flowSessions: {}, bookings: [],
  notificationLogs: [], feedbackSessions: {}, feedbacks: [], salonRatings: {}
};
let stateCache = structuredClone(EMPTY_STATE);

function normalizePhone(value) {
  const digits = String(value || "").replace(/\D+/g, "");
  if (!digits) return "";
  if (digits.length > 10) return digits.slice(-10);
  return digits;
}

// ─── INIT ────────────────────────────────────────────────────
export async function initDatabase() {
  stateCache = structuredClone(EMPTY_STATE);
  const connected = await connectMongo();
  if (connected) {
    initModels();
    try {
      const ratings = await SalonRatingModel.find({}).lean();
      for (const r of ratings) {
        stateCache.salonRatings[r.salonId] = {
          rating: r.rating,
          reviewCount: r.reviewCount,
          updatedAt: r.updatedAt
        };
      }
      console.log("[db] Loaded", ratings.length, "salon ratings from MongoDB");
    } catch (e) {
      console.warn("[db] Could not load ratings from MongoDB:", e.message);
    }
  }
  initDefaultRatings();
  return connected ? "mongodb" : "in-memory";
}

// ─── ONBOARDING ──────────────────────────────────────────────
export function getOnboardingState(phoneNumber) {
  const row = stateCache.onboarding[phoneNumber];
  return row && typeof row === "object" ? { ...row } : null;
}

export function setOnboardingState(phoneNumber, onboardingState) {
  const updated = { ...onboardingState, updatedAt: new Date().toISOString() };
  stateCache.onboarding[phoneNumber] = updated;
  if (isMongoConnected) {
    OnboardingModel.findOneAndUpdate(
      { phoneNumber },
      { phoneNumber, state: updated, updatedAt: updated.updatedAt },
      { upsert: true }
    ).catch(e => console.warn("[db] onboarding save:", e.message));
  }
  return { ...updated };
}

// ─── FLOW SESSION ────────────────────────────────────────────
export function getFlowSession(flowToken) {
  const row = stateCache.flowSessions[flowToken];
  return row && typeof row === "object" ? { ...row } : {};
}

export function setFlowSession(flowToken, session) {
  const updated = { ...session, updatedAt: new Date().toISOString() };
  stateCache.flowSessions[flowToken] = updated;
  if (isMongoConnected) {
    FlowSessionModel.findOneAndUpdate(
      { flowToken },
      { flowToken, session: updated, updatedAt: updated.updatedAt },
      { upsert: true }
    ).catch(e => console.warn("[db] flowSession save:", e.message));
  }
  return { ...updated };
}

// ─── BOOKINGS ────────────────────────────────────────────────
export async function insertBooking(booking) {
  const now = new Date().toISOString();
  const phone = normalizePhone(booking.mobile);
  if (!phone) throw new Error("mobile is required to create booking");

  const toSave = { ...booking, mobile: phone, createdAt: booking.createdAt || now, updatedAt: now };

  const idx = stateCache.bookings.findIndex(b => b.bookingId === booking.bookingId);
  if (idx >= 0) stateCache.bookings[idx] = toSave;
  else stateCache.bookings.unshift(toSave);

  if (isMongoConnected) {
    try {
      await BookingModel.findOneAndUpdate(
        { bookingId: toSave.bookingId },
        toSave,
        { upsert: true, new: true }
      );
    } catch (e) {
      console.warn("[db] booking save error:", e.message);
    }
  }
  return booking;
}

export async function listBookings() {
  if (isMongoConnected) {
    try {
      const docs = await BookingModel.find({}).sort({ createdAt: -1 }).lean();
      stateCache.bookings = docs;
      return [...docs];
    } catch (e) {
      console.warn("[db] listBookings MongoDB error:", e.message);
    }
  }
  return [...stateCache.bookings];
}

export async function listBookingsByMobile(mobile, limit = 10) {
  const phone = normalizePhone(mobile);
  if (!phone) return [];
  const safeLimit = Math.max(1, Math.min(20, Number(limit) || 10));

  if (isMongoConnected) {
    try {
      return await BookingModel.find({ mobile: phone })
        .sort({ createdAt: -1 }).limit(safeLimit).lean();
    } catch (e) {
      console.warn("[db] listBookingsByMobile MongoDB error:", e.message);
    }
  }
  return stateCache.bookings.filter(b => b.mobile === phone).slice(0, safeLimit);
}

export async function listUsers() {
  const bookings = await listBookings();
  const byMobile = new Map();
  for (const b of bookings) {
    if (!b.mobile || byMobile.has(b.mobile)) continue;
    byMobile.set(b.mobile, {
      userId: byMobile.size + 1,
      fullName: b.fullName || "",
      phone: b.mobile,
      email: b.email || "",
      createdAt: b.createdAt,
      updatedAt: b.updatedAt
    });
  }
  return [...byMobile.values()];
}

export async function listAppointments() {
  const bookings = await listBookings();
  return bookings.map((b, idx) => ({
    appointmentPk: idx + 1,
    appointmentId: b.bookingId,
    userId: idx + 1,
    status: b.status,
    salonId: b.salonId,
    salonName: b.salonName,
    mapsUrl: b.mapsUrl,
    gender: b.gender,
    serviceCategory: b.serviceCategory,
    serviceItem: b.serviceItem,
    serviceBlob: b.serviceBlob,
    date: b.date,
    stylistName: b.stylistName,
    timeSlot: b.timeSlot,
    createdAt: b.createdAt,
    updatedAt: b.updatedAt
  }));
}

// ─── NOTIFICATION LOGS ───────────────────────────────────────
export async function insertNotificationLog(log) {
  const entry = { ...log, savedAt: new Date().toISOString() };
  stateCache.notificationLogs.unshift(entry);
  if (isMongoConnected) {
    NotifLogModel.create({ data: log, savedAt: entry.savedAt })
      .catch(e => console.warn("[db] notifLog save:", e.message));
  }
  return log;
}

export async function listNotificationLogs(limit = 100) {
  return stateCache.notificationLogs.slice(0, Math.max(1, Math.min(500, Number(limit) || 100)));
}

// ─── FEEDBACK SESSION ────────────────────────────────────────
export function setFeedbackSession(mobile, session) {
  stateCache.feedbackSessions[mobile] = { ...session, updatedAt: new Date().toISOString() };
  if (isMongoConnected) {
    FeedbackSessionModel.findOneAndUpdate(
      { mobile },
      { mobile, session: stateCache.feedbackSessions[mobile], updatedAt: new Date().toISOString() },
      { upsert: true }
    ).catch(e => console.warn("[db] feedbackSession save:", e.message));
  }
}

export function getFeedbackSession(mobile) {
  return stateCache.feedbackSessions[mobile] || null;
}

export function clearFeedbackSession(mobile) {
  delete stateCache.feedbackSessions[mobile];
  if (isMongoConnected) {
    FeedbackSessionModel.deleteOne({ mobile })
      .catch(e => console.warn("[db] feedbackSession delete:", e.message));
  }
}

// ─── FEEDBACK ────────────────────────────────────────────────
export async function insertFeedback(feedback) {
  const entry = { ...feedback, savedAt: new Date().toISOString() };
  stateCache.feedbacks.unshift(entry);
  if (isMongoConnected) {
    FeedbackModel.create(entry)
      .catch(e => console.warn("[db] feedback save:", e.message));
  }
  return feedback;
}

export async function listFeedbacks(limit = 100) {
  return stateCache.feedbacks.slice(0, Math.max(1, Math.min(500, Number(limit) || 100)));
}

// ─── SALON RATINGS ───────────────────────────────────────────
export function setSalonRating(salonId, rating, reviewCount) {
  const entry = { rating: Number(rating), reviewCount: Number(reviewCount), updatedAt: new Date().toISOString() };
  stateCache.salonRatings[String(salonId)] = entry;
  if (isMongoConnected) {
    SalonRatingModel.findOneAndUpdate(
      { salonId: String(salonId) },
      { salonId: String(salonId), ...entry },
      { upsert: true }
    ).catch(e => console.warn("[db] salonRating save:", e.message));
  }
}

export function getSalonRating(salonId) {
  const r = stateCache.salonRatings[String(salonId)];
  return { rating: r?.rating ?? 4.8, reviewCount: r?.reviewCount ?? 150 };
}

export function listSalonRatings() {
  return Object.entries(stateCache.salonRatings).map(([id, v]) => ({ salonId: id, ...v }));
}

// ─── DAILY STATS — reads from MongoDB directly ───────────────
export async function getDailyStats(dateStr) {
  const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;
  const today = dateStr || new Date(Date.now() + IST_OFFSET_MS).toISOString().slice(0, 10);

  // ✅ Always fetch from MongoDB if connected (not stateCache which is empty after restart)
  let allBookings = [];
  if (isMongoConnected) {
    try {
      allBookings = await BookingModel.find({}).lean();
      console.log("[db] getDailyStats: fetched", allBookings.length, "total bookings from MongoDB");
    } catch (e) {
      console.warn("[db] getDailyStats MongoDB fetch failed:", e.message);
      allBookings = [...stateCache.bookings];
    }
  } else {
    allBookings = [...stateCache.bookings];
  }

  // Filter today's bookings
  // booking.date is "2026-06-27" format (set by customer during flow)
  // fallback to createdAt ISO string if date is missing
  const todayBookings = allBookings.filter(b => {
    const d = String(b.date || b.createdAt || "");
    return d.startsWith(today);
  });

  console.log("[db] getDailyStats: date=", today, "todayBookings=", todayBookings.length);

  const total     = todayBookings.length;
  const completed = todayBookings.filter(b => b.status === "CONFIRMED").length;
  const pending   = todayBookings.filter(b => !b.status || b.status === "PENDING_APPROVAL" || b.status === "PENDING").length;
  const cancelled = todayBookings.filter(b => b.status === "REJECTED" || b.status === "CANCELLED").length;
  const noShow    = todayBookings.filter(b => b.status === "NO_SHOW").length;
  const walkIn    = todayBookings.filter(b => b.isWalkIn === true).length;
  const online    = total - walkIn;

  // Service breakdown
  const serviceMap = {};
  for (const b of todayBookings) {
    const services = String(b.serviceItem || b.serviceBlob || "General").split(/[;,]+/).map(s => s.trim()).filter(Boolean);
    for (const svc of services) {
      if (!serviceMap[svc]) serviceMap[svc] = { total: 0, completed: 0, pending: 0 };
      serviceMap[svc].total++;
      if (b.status === "CONFIRMED") serviceMap[svc].completed++;
      else if (!b.status || b.status === "PENDING_APPROVAL" || b.status === "PENDING") serviceMap[svc].pending++;
    }
  }

  // Staff breakdown
  const staffMap = {};
  for (const b of todayBookings) {
    const stylist = String(b.stylistName || "Unassigned").trim();
    if (!staffMap[stylist]) staffMap[stylist] = { served: 0, completed: 0 };
    staffMap[stylist].served++;
    if (b.status === "CONFIRMED") staffMap[stylist].completed++;
  }

  // Hourly distribution
  const hourlyMap = {};
  for (const b of todayBookings) {
    let hour = null;
    const slotMatch = String(b.timeSlot || "").match(/^(\d{1,2}):(\d{2})\s*([AP]M)/i);
    if (slotMatch) {
      let h = Number(slotMatch[1]);
      const meridiem = slotMatch[3].toUpperCase();
      if (meridiem === "PM" && h !== 12) h += 12;
      if (meridiem === "AM" && h === 12) h = 0;
      hour = h;
    } else {
      const ts = String(b.createdAt || "");
      const hMatch = ts.match(/T(\d{2}):/);
      if (hMatch) hour = (Number(hMatch[1]) + 5) % 24;
    }
    if (hour !== null) hourlyMap[hour] = (hourlyMap[hour] || 0) + 1;
  }

  // Peak hour
  let peakHour = null, peakCount = 0;
  for (const [h, cnt] of Object.entries(hourlyMap)) {
    if (cnt > peakCount) { peakCount = cnt; peakHour = Number(h); }
  }
  function formatHour(h) {
    if (h === null) return "—";
    const ampm = h >= 12 ? "PM" : "AM";
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${h12}:00 ${ampm}`;
  }

  // Salon breakdown top 5
  const salonMap = {};
  for (const b of todayBookings) {
    const name = String(b.salonName || b.salonId || "Unknown");
    salonMap[name] = (salonMap[name] || 0) + 1;
  }
  const topSalons = Object.entries(salonMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, count]) => ({ name, count }));

  const completionRate = total > 0 ? ((completed / total) * 100).toFixed(1) : "0.0";
  const pendingRate    = total > 0 ? ((pending   / total) * 100).toFixed(1) : "0.0";
  const cancelledRate  = total > 0 ? ((cancelled / total) * 100).toFixed(1) : "0.0";
  const noShowRate     = total > 0 ? ((noShow    / total) * 100).toFixed(1) : "0.0";

  return {
    date: today, total, completed, pending, cancelled, noShow, walkIn, online,
    completionRate, pendingRate, cancelledRate, noShowRate,
    peakHour: formatHour(peakHour), peakCount, hourlyMap,
    serviceBreakdown: Object.entries(serviceMap).map(([name, v]) => ({ name, ...v })).sort((a, b) => b.total - a.total),
    staffBreakdown:   Object.entries(staffMap).map(([name, v])   => ({ name, ...v })).sort((a, b) => b.served - a.served),
    topSalons,
    allTimeTotal: allBookings.length
  };
}

// ─── DEFAULT SALON RATINGS ───────────────────────────────────
function initDefaultRatings() {
  const defaults = {
    "1103": { rating: 4.8, reviewCount: 91 },
    "1150": { rating: 4.9, reviewCount: 147 },
    "1152": { rating: 4.6, reviewCount: 273 },
    "1154": { rating: 4.6, reviewCount: 274 },
    "1158": { rating: 4.9, reviewCount: 107 },
    "1161": { rating: 4.8, reviewCount: 93 },
    "1162": { rating: 4.5, reviewCount: 140 },
    "1165": { rating: 4.6, reviewCount: 239 },
    "1168": { rating: 4.5, reviewCount: 135 },
    "1169": { rating: 4.9, reviewCount: 264 },
    "1170": { rating: 4.8, reviewCount: 141 },
    "1172": { rating: 4.7, reviewCount: 156 },
    "1173": { rating: 4.9, reviewCount: 86 },
    "1178": { rating: 4.9, reviewCount: 125 },
    "1184": { rating: 4.8, reviewCount: 172 },
    "1185": { rating: 4.6, reviewCount: 140 },
    "1186": { rating: 5.0, reviewCount: 171 },
    "1187": { rating: 4.6, reviewCount: 182 },
    "1188": { rating: 4.5, reviewCount: 301 },
    "1192": { rating: 4.7, reviewCount: 152 },
    "1194": { rating: 4.9, reviewCount: 271 },
    "1196": { rating: 4.7, reviewCount: 116 },
    "1197": { rating: 5.0, reviewCount: 181 },
    "1199": { rating: 4.5, reviewCount: 160 },
    "1204": { rating: 4.9, reviewCount: 243 },
    "1206": { rating: 4.9, reviewCount: 177 },
    "1207": { rating: 4.8, reviewCount: 265 },
    "1208": { rating: 4.5, reviewCount: 254 },
    "1210": { rating: 4.6, reviewCount: 159 },
    "1216": { rating: 5.0, reviewCount: 303 },
    "1217": { rating: 4.6, reviewCount: 110 },
    "1218": { rating: 4.7, reviewCount: 201 },
    "1226": { rating: 4.8, reviewCount: 178 },
    "1227": { rating: 4.6, reviewCount: 175 },
    "1228": { rating: 4.6, reviewCount: 153 },
    "1230": { rating: 4.9, reviewCount: 259 },
    "1234": { rating: 4.8, reviewCount: 240 },
    "1236": { rating: 4.8, reviewCount: 221 },
    "1237": { rating: 4.9, reviewCount: 126 },
    "1244": { rating: 4.7, reviewCount: 154 },
    "1246": { rating: 5.0, reviewCount: 248 },
    "1249": { rating: 4.8, reviewCount: 141 },
    "1252": { rating: 4.8, reviewCount: 300 },
    "1253": { rating: 4.9, reviewCount: 99 },
    "1256": { rating: 4.6, reviewCount: 93 },
    "1257": { rating: 4.9, reviewCount: 187 },
    "1258": { rating: 4.6, reviewCount: 139 },
    "1259": { rating: 5.0, reviewCount: 230 },
    "1260": { rating: 4.9, reviewCount: 165 },
    "1261": { rating: 4.6, reviewCount: 212 },
    "1262": { rating: 4.7, reviewCount: 319 },
    "1264": { rating: 4.8, reviewCount: 121 },
    "1267": { rating: 4.6, reviewCount: 148 },
    "1268": { rating: 4.9, reviewCount: 222 },
    "1271": { rating: 4.6, reviewCount: 234 },
    "1272": { rating: 4.7, reviewCount: 234 },
    "1273": { rating: 4.7, reviewCount: 141 },
    "1274": { rating: 5.0, reviewCount: 120 },
    "1276": { rating: 4.8, reviewCount: 108 },
    "1279": { rating: 4.9, reviewCount: 305 },
    "1280": { rating: 4.6, reviewCount: 245 },
    "1283": { rating: 4.6, reviewCount: 259 },
    "1287": { rating: 4.7, reviewCount: 101 },
    "1290": { rating: 4.7, reviewCount: 237 },
    "1293": { rating: 5.0, reviewCount: 220 },
    "1294": { rating: 4.6, reviewCount: 226 },
    "1296": { rating: 4.9, reviewCount: 87 },
    "1298": { rating: 4.8, reviewCount: 114 },
    "1301": { rating: 4.8, reviewCount: 222 },
    "1302": { rating: 4.9, reviewCount: 281 },
    "1303": { rating: 4.8, reviewCount: 113 },
    "1304": { rating: 4.6, reviewCount: 125 },
    "1305": { rating: 4.7, reviewCount: 269 },
    "1307": { rating: 4.9, reviewCount: 152 },
    "1308": { rating: 5.0, reviewCount: 280 },
    "1309": { rating: 4.6, reviewCount: 318 },
    "1315": { rating: 4.6, reviewCount: 245 },
    "1318": { rating: 4.6, reviewCount: 248 },
    "1319": { rating: 4.8, reviewCount: 135 },
    "1320": { rating: 4.6, reviewCount: 280 },
    "1321": { rating: 4.6, reviewCount: 284 },
    "1323": { rating: 5.0, reviewCount: 320 },
    "1325": { rating: 4.5, reviewCount: 167 },
    "1327": { rating: 4.7, reviewCount: 113 },
    "1330": { rating: 5.0, reviewCount: 309 },
    "1332": { rating: 5.0, reviewCount: 291 },
    "1333": { rating: 4.7, reviewCount: 99 },
    "1334": { rating: 4.6, reviewCount: 178 }
  };

  // Only set defaults for salons not already in cache (admin-set ratings take priority)
  for (const [id, val] of Object.entries(defaults)) {
    if (!stateCache.salonRatings[id]) {
      stateCache.salonRatings[id] = { ...val, updatedAt: new Date().toISOString() };
    }
  }
}
