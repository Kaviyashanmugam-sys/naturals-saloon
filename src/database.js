// src/database.js
// Naturals Salon — MongoDB + In-Memory Hybrid Database
// MongoDB உண்டா → persist, இல்லன்னா → in-memory fallback

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
  mobile:             String,
  rating:             Number,
  customer_name:      String,
  branch_name:        String,
  appointment_id:     mongoose.Schema.Types.Mixed,
  feedback_text:      String,
  staff_performance:  String,
  amenities_rating:   String,
  overall_experience: String,
  google_review_shown: Boolean,
  savedAt:            String
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
  BookingModel       = mongoose.models.Booking       || mongoose.model("Booking",       BookingSchema);
  OnboardingModel    = mongoose.models.Onboarding    || mongoose.model("Onboarding",    OnboardingSchema);
  FlowSessionModel   = mongoose.models.FlowSession   || mongoose.model("FlowSession",   FlowSessionSchema);
  FeedbackModel      = mongoose.models.Feedback      || mongoose.model("Feedback",      FeedbackSchema);
  FeedbackSessionModel = mongoose.models.FeedbackSession || mongoose.model("FeedbackSession", FeedbackSessionSchema);
  SalonRatingModel   = mongoose.models.SalonRating   || mongoose.model("SalonRating",   SalonRatingSchema);
  NotifLogModel      = mongoose.models.NotificationLog || mongoose.model("NotificationLog", NotificationLogSchema);
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
    // Load ratings into memory cache from MongoDB
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

  // In-memory
  const idx = stateCache.bookings.findIndex(b => b.bookingId === booking.bookingId);
  if (idx >= 0) stateCache.bookings[idx] = toSave;
  else stateCache.bookings.unshift(toSave);

  // MongoDB
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
      // Sync to memory
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

// ─── DAILY STATS ─────────────────────────────────────────────
export function getDailyStats(dateStr) {
  const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;
  const today = dateStr || new Date(Date.now() + IST_OFFSET_MS).toISOString().slice(0, 10);
  const allBookings = stateCache.bookings;
  const todayBookings = allBookings.filter(b => String(b.date || b.createdAt || "").startsWith(today));

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
  const topSalons = Object.entries(salonMap).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name, count]) => ({ name, count }));

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

const DEFAULT_SALON_RATINGS = {
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
  "1334": { rating: 4.6, reviewCount: 230 },
  "1335": { rating: 5.0, reviewCount: 106 },
  "1336": { rating: 4.9, reviewCount: 293 },
  "1337": { rating: 4.5, reviewCount: 279 },
  "1340": { rating: 4.8, reviewCount: 117 },
  "1342": { rating: 4.6, reviewCount: 206 },
  "1344": { rating: 5.0, reviewCount: 127 },
  "1347": { rating: 4.6, reviewCount: 308 },
  "1353": { rating: 4.8, reviewCount: 139 },
  "1356": { rating: 5.0, reviewCount: 278 },
  "1357": { rating: 4.9, reviewCount: 136 },
  "1359": { rating: 4.9, reviewCount: 187 },
  "1360": { rating: 5.0, reviewCount: 251 },
  "1370": { rating: 4.7, reviewCount: 315 },
  "1373": { rating: 4.8, reviewCount: 115 },
  "1375": { rating: 4.6, reviewCount: 101 },
  "1376": { rating: 4.7, reviewCount: 235 },
  "1377": { rating: 4.8, reviewCount: 235 },
  "1379": { rating: 4.6, reviewCount: 103 },
  "1380": { rating: 4.9, reviewCount: 100 },
  "1381": { rating: 4.6, reviewCount: 316 },
  "1384": { rating: 4.5, reviewCount: 169 },
  "1385": { rating: 4.5, reviewCount: 145 },
  "1387": { rating: 4.6, reviewCount: 209 },
  "1388": { rating: 4.6, reviewCount: 118 },
  "1389": { rating: 4.9, reviewCount: 310 },
  "1391": { rating: 4.8, reviewCount: 206 },
  "1392": { rating: 4.6, reviewCount: 206 },
  "1397": { rating: 4.9, reviewCount: 133 },
  "1400": { rating: 4.5, reviewCount: 253 },
  "1402": { rating: 4.7, reviewCount: 193 },
  "1407": { rating: 4.7, reviewCount: 306 },
  "1408": { rating: 4.9, reviewCount: 257 },
  "1410": { rating: 4.8, reviewCount: 250 },
  "1412": { rating: 4.5, reviewCount: 188 },
  "1413": { rating: 4.9, reviewCount: 289 },
  "1415": { rating: 4.9, reviewCount: 148 },
  "1418": { rating: 4.6, reviewCount: 222 },
  "1420": { rating: 4.7, reviewCount: 193 },
  "1421": { rating: 4.6, reviewCount: 203 },
  "1422": { rating: 4.6, reviewCount: 104 },
  "1423": { rating: 4.7, reviewCount: 305 },
  "1424": { rating: 4.9, reviewCount: 110 },
  "1425": { rating: 4.5, reviewCount: 223 },
  "1427": { rating: 4.9, reviewCount: 108 },
  "1430": { rating: 5.0, reviewCount: 302 },
  "1435": { rating: 4.6, reviewCount: 189 },
  "1436": { rating: 4.7, reviewCount: 139 },
  "1439": { rating: 4.9, reviewCount: 316 },
  "1441": { rating: 4.5, reviewCount: 182 },
  "1442": { rating: 4.5, reviewCount: 184 },
  "1443": { rating: 4.6, reviewCount: 285 },
  "1446": { rating: 4.9, reviewCount: 158 },
  "1447": { rating: 4.7, reviewCount: 272 },
  "1448": { rating: 5.0, reviewCount: 227 },
  "1449": { rating: 4.8, reviewCount: 209 },
  "1450": { rating: 4.6, reviewCount: 160 },
  "1451": { rating: 4.6, reviewCount: 99 },
  "1452": { rating: 4.8, reviewCount: 223 },
  "1453": { rating: 4.5, reviewCount: 165 },
  "1454": { rating: 4.5, reviewCount: 234 },
  "1455": { rating: 4.7, reviewCount: 320 },
  "1456": { rating: 4.9, reviewCount: 125 },
  "1457": { rating: 4.5, reviewCount: 215 },
  "1459": { rating: 4.5, reviewCount: 132 },
  "1460": { rating: 4.5, reviewCount: 102 },
  "1462": { rating: 4.8, reviewCount: 145 },
  "1464": { rating: 4.7, reviewCount: 312 },
  "1465": { rating: 4.8, reviewCount: 233 },
  "1468": { rating: 4.8, reviewCount: 243 },
  "1470": { rating: 4.5, reviewCount: 253 },
  "1471": { rating: 4.8, reviewCount: 218 },
  "1474": { rating: 4.7, reviewCount: 151 },
  "1478": { rating: 4.6, reviewCount: 268 },
  "1480": { rating: 4.7, reviewCount: 152 },
  "1481": { rating: 4.7, reviewCount: 256 },
  "1482": { rating: 4.8, reviewCount: 202 },
  "1486": { rating: 4.7, reviewCount: 277 },
  "1487": { rating: 5.0, reviewCount: 87 },
  "1488": { rating: 4.7, reviewCount: 229 },
  "1489": { rating: 5.0, reviewCount: 103 },
  "1490": { rating: 4.8, reviewCount: 214 },
  "1491": { rating: 4.6, reviewCount: 174 },
  "1493": { rating: 4.9, reviewCount: 310 },
  "1496": { rating: 4.6, reviewCount: 157 },
  "1498": { rating: 4.6, reviewCount: 298 },
  "1499": { rating: 4.8, reviewCount: 162 },
  "1500": { rating: 4.8, reviewCount: 291 },
  "1501": { rating: 4.8, reviewCount: 87 },
  "1504": { rating: 4.8, reviewCount: 226 },
  "1505": { rating: 4.6, reviewCount: 254 },
  "1506": { rating: 4.6, reviewCount: 309 },
  "1507": { rating: 4.6, reviewCount: 114 },
  "1509": { rating: 4.9, reviewCount: 275 },
  "1512": { rating: 4.8, reviewCount: 154 },
  "1514": { rating: 4.6, reviewCount: 138 },
  "1515": { rating: 4.9, reviewCount: 137 },
  "1518": { rating: 4.8, reviewCount: 303 },
  "1519": { rating: 4.6, reviewCount: 210 },
  "1520": { rating: 4.6, reviewCount: 317 },
  "1522": { rating: 4.9, reviewCount: 108 },
  "1523": { rating: 4.8, reviewCount: 297 },
  "1524": { rating: 4.6, reviewCount: 85 },
  "1525": { rating: 4.7, reviewCount: 118 },
  "1526": { rating: 4.8, reviewCount: 152 },
  "1528": { rating: 4.6, reviewCount: 198 },
  "1530": { rating: 4.8, reviewCount: 194 },
  "1531": { rating: 4.8, reviewCount: 113 },
  "1534": { rating: 4.5, reviewCount: 311 },
  "1535": { rating: 4.8, reviewCount: 123 },
  "1539": { rating: 4.8, reviewCount: 298 },
  "1541": { rating: 4.7, reviewCount: 226 },
  "1542": { rating: 4.6, reviewCount: 117 },
  "1543": { rating: 4.5, reviewCount: 178 },
  "1546": { rating: 4.9, reviewCount: 288 },
  "1548": { rating: 5.0, reviewCount: 95 },
  "1549": { rating: 4.9, reviewCount: 138 },
  "1550": { rating: 4.8, reviewCount: 255 },
  "1551": { rating: 4.6, reviewCount: 284 },
  "1552": { rating: 4.8, reviewCount: 308 },
  "1553": { rating: 4.7, reviewCount: 243 },
  "1555": { rating: 4.9, reviewCount: 145 },
  "1557": { rating: 4.9, reviewCount: 289 },
  "1558": { rating: 4.9, reviewCount: 310 },
  "1559": { rating: 4.7, reviewCount: 130 },
  "1560": { rating: 4.9, reviewCount: 170 },
  "1562": { rating: 4.9, reviewCount: 190 },
  "1563": { rating: 4.9, reviewCount: 306 },
  "1564": { rating: 4.9, reviewCount: 148 },
  "1566": { rating: 4.6, reviewCount: 286 },
  "1567": { rating: 4.9, reviewCount: 182 },
  "1568": { rating: 4.9, reviewCount: 304 },
  "1569": { rating: 4.7, reviewCount: 136 },
  "1570": { rating: 4.9, reviewCount: 202 },
  "1571": { rating: 4.7, reviewCount: 295 },
  "1572": { rating: 4.9, reviewCount: 143 },
  "1580": { rating: 4.6, reviewCount: 253 },
  "1581": { rating: 4.6, reviewCount: 169 },
  "1587": { rating: 4.6, reviewCount: 102 },
  "1590": { rating: 5.0, reviewCount: 156 },
  "1591": { rating: 4.7, reviewCount: 215 },
  "1593": { rating: 4.7, reviewCount: 300 },
  "1595": { rating: 4.8, reviewCount: 92 },
  "1599": { rating: 4.6, reviewCount: 151 },
  "1607": { rating: 4.6, reviewCount: 152 },
  "1641": { rating: 4.5, reviewCount: 237 },
  "1649": { rating: 4.7, reviewCount: 271 },
  "1650": { rating: 4.9, reviewCount: 196 },
  "1652": { rating: 4.8, reviewCount: 215 },
  "1655": { rating: 4.6, reviewCount: 315 },
  "1656": { rating: 4.8, reviewCount: 150 },
  "1658": { rating: 4.5, reviewCount: 196 },
  "1659": { rating: 4.5, reviewCount: 291 },
  "1660": { rating: 4.8, reviewCount: 269 },
  "1663": { rating: 5.0, reviewCount: 273 },
  "1664": { rating: 4.8, reviewCount: 178 },
  "1665": { rating: 4.7, reviewCount: 255 },
  "1667": { rating: 5.0, reviewCount: 244 },
  "1668": { rating: 4.7, reviewCount: 302 },
  "1669": { rating: 4.6, reviewCount: 315 },
  "1671": { rating: 4.7, reviewCount: 164 },
  "1672": { rating: 4.8, reviewCount: 168 },
  "1674": { rating: 4.7, reviewCount: 160 },
  "1676": { rating: 4.8, reviewCount: 134 },
  "1677": { rating: 4.7, reviewCount: 182 },
  "1683": { rating: 4.8, reviewCount: 316 },
  "1684": { rating: 4.6, reviewCount: 230 },
  "1685": { rating: 4.7, reviewCount: 225 },
  "1686": { rating: 4.9, reviewCount: 162 },
  "1687": { rating: 4.6, reviewCount: 195 },
  "1691": { rating: 4.9, reviewCount: 240 },
  "1692": { rating: 4.8, reviewCount: 204 },
  "1693": { rating: 4.7, reviewCount: 257 },
  "1695": { rating: 4.6, reviewCount: 206 },
  "1697": { rating: 4.9, reviewCount: 288 },
  "1698": { rating: 4.9, reviewCount: 253 },
  "1700": { rating: 4.5, reviewCount: 216 },
  "1701": { rating: 4.8, reviewCount: 243 },
  "1703": { rating: 4.7, reviewCount: 294 },
  "1704": { rating: 5.0, reviewCount: 145 },
  "1705": { rating: 4.8, reviewCount: 142 },
  "1706": { rating: 4.9, reviewCount: 122 },
  "1709": { rating: 4.5, reviewCount: 147 },
  "1710": { rating: 5.0, reviewCount: 241 },
  "1711": { rating: 4.9, reviewCount: 103 },
  "1712": { rating: 4.7, reviewCount: 311 },
  "1713": { rating: 4.8, reviewCount: 134 },
  "1714": { rating: 4.9, reviewCount: 183 },
  "1716": { rating: 4.7, reviewCount: 147 },
  "1717": { rating: 4.6, reviewCount: 261 },
  "1718": { rating: 4.5, reviewCount: 277 },
  "1719": { rating: 4.9, reviewCount: 311 },
  "1720": { rating: 4.6, reviewCount: 193 },
  "1721": { rating: 4.6, reviewCount: 290 },
  "1724": { rating: 5.0, reviewCount: 217 },
  "1725": { rating: 4.7, reviewCount: 227 },
  "1726": { rating: 4.6, reviewCount: 302 },
  "1728": { rating: 4.6, reviewCount: 119 },
  "1731": { rating: 4.9, reviewCount: 255 },
  "1732": { rating: 4.8, reviewCount: 228 },
  "1733": { rating: 4.8, reviewCount: 278 },
  "1734": { rating: 4.9, reviewCount: 241 },
  "1735": { rating: 4.9, reviewCount: 313 },
  "1736": { rating: 4.8, reviewCount: 297 },
  "1740": { rating: 5.0, reviewCount: 199 },
  "1741": { rating: 4.9, reviewCount: 275 },
  "1742": { rating: 4.9, reviewCount: 200 },
  "1743": { rating: 4.6, reviewCount: 148 },
  "1744": { rating: 4.9, reviewCount: 155 },
  "1745": { rating: 4.9, reviewCount: 218 },
  "1746": { rating: 4.7, reviewCount: 146 },
  "1747": { rating: 4.6, reviewCount: 104 },
  "1749": { rating: 4.9, reviewCount: 145 },
  "1750": { rating: 4.6, reviewCount: 166 },
  "1751": { rating: 4.9, reviewCount: 105 },
  "1752": { rating: 4.6, reviewCount: 144 },
  "1754": { rating: 4.7, reviewCount: 124 },
  "1755": { rating: 4.9, reviewCount: 101 },
  "1756": { rating: 4.7, reviewCount: 169 },
  "1757": { rating: 4.8, reviewCount: 191 },
  "1758": { rating: 4.5, reviewCount: 298 },
  "1760": { rating: 4.7, reviewCount: 316 },
  "1767": { rating: 4.9, reviewCount: 263 },
  "1770": { rating: 4.5, reviewCount: 310 },
  "1774": { rating: 4.9, reviewCount: 182 },
  "1780": { rating: 4.7, reviewCount: 175 },
  "1785": { rating: 4.6, reviewCount: 184 },
  "1789": { rating: 4.9, reviewCount: 298 },
  "1790": { rating: 4.7, reviewCount: 276 },
  "1791": { rating: 4.9, reviewCount: 289 },
  "1792": { rating: 4.8, reviewCount: 141 },
  "1793": { rating: 4.7, reviewCount: 154 },
  "1794": { rating: 4.7, reviewCount: 92 },
  "1796": { rating: 4.7, reviewCount: 256 },
  "1797": { rating: 4.8, reviewCount: 188 },
  "1798": { rating: 4.9, reviewCount: 300 },
  "1799": { rating: 4.7, reviewCount: 117 },
  "1800": { rating: 5.0, reviewCount: 221 },
  "1801": { rating: 4.5, reviewCount: 185 },
  "1802": { rating: 4.8, reviewCount: 254 },
  "1803": { rating: 4.5, reviewCount: 249 },
  "1804": { rating: 4.7, reviewCount: 306 },
  "1805": { rating: 4.7, reviewCount: 97 },
  "1806": { rating: 4.6, reviewCount: 168 },
  "1807": { rating: 4.6, reviewCount: 168 },
  "1808": { rating: 4.7, reviewCount: 310 },
  "1809": { rating: 4.7, reviewCount: 277 },
  "1810": { rating: 5.0, reviewCount: 192 },
  "1812": { rating: 4.6, reviewCount: 105 },
  "1813": { rating: 4.7, reviewCount: 276 },
  "1814": { rating: 4.8, reviewCount: 174 },
  "1815": { rating: 4.6, reviewCount: 102 },
  "1817": { rating: 4.9, reviewCount: 251 },
  "1819": { rating: 4.5, reviewCount: 92 },
  "1820": { rating: 5.0, reviewCount: 136 },
  "1821": { rating: 4.9, reviewCount: 244 },
  "1822": { rating: 4.6, reviewCount: 117 },
  "1823": { rating: 4.7, reviewCount: 114 },
  "1824": { rating: 4.8, reviewCount: 140 },
  "1825": { rating: 4.7, reviewCount: 150 },
  "1826": { rating: 4.9, reviewCount: 127 },
  "1827": { rating: 4.8, reviewCount: 276 },
  "1828": { rating: 4.9, reviewCount: 284 },
  "1829": { rating: 4.9, reviewCount: 164 },
  "1830": { rating: 4.6, reviewCount: 91 },
  "1832": { rating: 5.0, reviewCount: 232 },
  "1834": { rating: 4.8, reviewCount: 181 },
  "1836": { rating: 4.7, reviewCount: 268 },
  "1839": { rating: 4.6, reviewCount: 236 },
  "1841": { rating: 4.8, reviewCount: 245 },
  "1842": { rating: 4.6, reviewCount: 263 },
  "1843": { rating: 4.9, reviewCount: 302 },
  "1849": { rating: 4.8, reviewCount: 291 },
  "1851": { rating: 4.6, reviewCount: 229 },
  "1853": { rating: 4.9, reviewCount: 173 },
  "1854": { rating: 4.8, reviewCount: 254 },
  "1856": { rating: 4.7, reviewCount: 214 },
  "1857": { rating: 4.8, reviewCount: 88 },
  "1858": { rating: 4.9, reviewCount: 295 },
  "1859": { rating: 4.7, reviewCount: 195 },
  "1860": { rating: 5.0, reviewCount: 247 },
  "1861": { rating: 4.9, reviewCount: 202 },
  "1862": { rating: 4.9, reviewCount: 196 },
  "1863": { rating: 4.6, reviewCount: 218 },
  "1864": { rating: 5.0, reviewCount: 154 },
  "1866": { rating: 4.8, reviewCount: 320 },
  "1867": { rating: 4.8, reviewCount: 208 },
  "1868": { rating: 4.7, reviewCount: 296 },
  "1869": { rating: 4.9, reviewCount: 153 },
  "1870": { rating: 4.7, reviewCount: 147 },
  "1871": { rating: 4.9, reviewCount: 107 },
  "1873": { rating: 4.6, reviewCount: 200 },
  "1874": { rating: 4.6, reviewCount: 203 },
  "1875": { rating: 4.8, reviewCount: 256 },
  "1878": { rating: 4.7, reviewCount: 92 },
  "1879": { rating: 4.7, reviewCount: 168 },
  "1880": { rating: 4.6, reviewCount: 139 },
  "1881": { rating: 4.7, reviewCount: 151 },
  "1882": { rating: 4.7, reviewCount: 310 },
  "1883": { rating: 4.8, reviewCount: 310 },
  "1884": { rating: 4.6, reviewCount: 87 },
  "1885": { rating: 4.8, reviewCount: 133 },
  "1886": { rating: 4.5, reviewCount: 269 },
  "1887": { rating: 4.7, reviewCount: 227 },
  "1888": { rating: 4.9, reviewCount: 261 },
  "1890": { rating: 4.7, reviewCount: 267 },
  "1891": { rating: 4.7, reviewCount: 287 },
  "1892": { rating: 4.5, reviewCount: 160 },
  "1897": { rating: 4.6, reviewCount: 262 },
  "1898": { rating: 4.6, reviewCount: 254 },
  "1900": { rating: 4.8, reviewCount: 206 },
  "1901": { rating: 4.8, reviewCount: 173 },
  "1902": { rating: 4.7, reviewCount: 275 },
  "1903": { rating: 4.8, reviewCount: 175 },
  "1905": { rating: 4.9, reviewCount: 154 },
  "1907": { rating: 4.7, reviewCount: 144 },
  "1908": { rating: 4.6, reviewCount: 134 },
  "1909": { rating: 4.7, reviewCount: 275 },
  "1911": { rating: 4.8, reviewCount: 280 },
  "1912": { rating: 4.8, reviewCount: 134 },
  "1913": { rating: 4.6, reviewCount: 208 },
  "1914": { rating: 4.6, reviewCount: 235 },
  "1915": { rating: 5.0, reviewCount: 219 },
  "1916": { rating: 4.8, reviewCount: 110 },
  "1917": { rating: 4.9, reviewCount: 160 },
  "1919": { rating: 4.6, reviewCount: 130 },
  "1921": { rating: 4.7, reviewCount: 266 },
  "1923": { rating: 4.8, reviewCount: 155 },
  "1924": { rating: 4.5, reviewCount: 98 },
  "1925": { rating: 4.8, reviewCount: 263 },
  "1926": { rating: 5.0, reviewCount: 248 },
  "1927": { rating: 4.9, reviewCount: 210 },
  "1928": { rating: 4.6, reviewCount: 88 },
  "1929": { rating: 4.8, reviewCount: 205 },
  "1930": { rating: 4.7, reviewCount: 172 },
  "1931": { rating: 4.6, reviewCount: 98 },
  "1932": { rating: 4.6, reviewCount: 305 },
  "1933": { rating: 4.7, reviewCount: 295 },
  "1934": { rating: 4.5, reviewCount: 210 },
  "1936": { rating: 4.5, reviewCount: 246 },
  "1937": { rating: 4.8, reviewCount: 123 },
  "1938": { rating: 4.6, reviewCount: 229 },
  "1939": { rating: 5.0, reviewCount: 106 },
  "1940": { rating: 5.0, reviewCount: 115 },
  "1941": { rating: 4.8, reviewCount: 191 },
  "1942": { rating: 4.8, reviewCount: 287 },
  "1943": { rating: 4.8, reviewCount: 283 },
  "1945": { rating: 4.8, reviewCount: 200 },
  "1946": { rating: 5.0, reviewCount: 161 },
  "1947": { rating: 4.9, reviewCount: 194 },
  "1948": { rating: 4.7, reviewCount: 243 },
  "1951": { rating: 4.5, reviewCount: 274 },
  "1952": { rating: 4.5, reviewCount: 280 },
  "1953": { rating: 4.6, reviewCount: 139 },
  "1954": { rating: 4.6, reviewCount: 105 },
  "1955": { rating: 4.6, reviewCount: 129 },
  "1956": { rating: 4.8, reviewCount: 125 },
  "1957": { rating: 4.5, reviewCount: 200 },
  "1959": { rating: 4.8, reviewCount: 205 },
  "1960": { rating: 4.6, reviewCount: 144 },
  "1961": { rating: 4.6, reviewCount: 157 },
  "1962": { rating: 4.9, reviewCount: 201 },
  "1963": { rating: 4.5, reviewCount: 144 },
  "1964": { rating: 5.0, reviewCount: 286 },
  "1965": { rating: 4.9, reviewCount: 235 },
  "1966": { rating: 4.8, reviewCount: 135 },
  "1967": { rating: 4.7, reviewCount: 224 },
  "1969": { rating: 4.6, reviewCount: 123 },
  "1970": { rating: 5.0, reviewCount: 296 },
  "1971": { rating: 4.6, reviewCount: 100 },
  "1972": { rating: 4.6, reviewCount: 163 },
  "1973": { rating: 4.8, reviewCount: 296 },
  "1974": { rating: 4.8, reviewCount: 158 },
  "1975": { rating: 4.7, reviewCount: 204 },
  "1976": { rating: 4.8, reviewCount: 264 },
  "1977": { rating: 4.7, reviewCount: 154 },
  "1978": { rating: 4.8, reviewCount: 211 },
  "1979": { rating: 4.7, reviewCount: 238 },
  "1980": { rating: 4.5, reviewCount: 195 },
  "1981": { rating: 4.9, reviewCount: 239 },
  "1982": { rating: 4.6, reviewCount: 108 },
  "1983": { rating: 4.6, reviewCount: 257 },
  "1984": { rating: 4.9, reviewCount: 232 },
  "1986": { rating: 4.8, reviewCount: 90 },
  "1987": { rating: 5.0, reviewCount: 257 },
  "1988": { rating: 4.9, reviewCount: 232 },
  "1989": { rating: 4.5, reviewCount: 278 },
  "1991": { rating: 4.6, reviewCount: 217 },
  "1994": { rating: 4.8, reviewCount: 319 },
  "1995": { rating: 4.6, reviewCount: 234 },
  "1996": { rating: 4.7, reviewCount: 293 },
  "1997": { rating: 4.7, reviewCount: 108 },
  "1998": { rating: 4.7, reviewCount: 189 },
  "2000": { rating: 4.7, reviewCount: 256 },
  "2001": { rating: 4.6, reviewCount: 126 },
  "2002": { rating: 4.7, reviewCount: 262 },
  "2003": { rating: 4.7, reviewCount: 254 },
  "2004": { rating: 5.0, reviewCount: 293 },
  "2006": { rating: 4.9, reviewCount: 94 },
  "2007": { rating: 4.7, reviewCount: 165 },
  "2009": { rating: 4.6, reviewCount: 114 },
  "2010": { rating: 5.0, reviewCount: 188 },
  "2011": { rating: 4.9, reviewCount: 296 },
  "2012": { rating: 5.0, reviewCount: 253 },
  "2013": { rating: 4.9, reviewCount: 203 },
  "2014": { rating: 4.7, reviewCount: 133 },
  "2015": { rating: 4.8, reviewCount: 244 },
  "2016": { rating: 4.9, reviewCount: 245 },
  "2018": { rating: 4.7, reviewCount: 98 },
  "2019": { rating: 4.6, reviewCount: 225 },
  "2021": { rating: 4.6, reviewCount: 158 },
  "2022": { rating: 4.7, reviewCount: 263 },
  "2023": { rating: 4.7, reviewCount: 92 },
  "2024": { rating: 5.0, reviewCount: 240 },
  "2025": { rating: 4.9, reviewCount: 266 },
  "2026": { rating: 4.6, reviewCount: 226 },
  "2027": { rating: 4.5, reviewCount: 189 },
  "2028": { rating: 4.5, reviewCount: 300 },
  "2030": { rating: 5.0, reviewCount: 203 },
  "2032": { rating: 5.0, reviewCount: 250 },
  "2034": { rating: 4.9, reviewCount: 212 },
  "2035": { rating: 5.0, reviewCount: 159 },
  "2036": { rating: 4.8, reviewCount: 154 },
  "2037": { rating: 4.7, reviewCount: 208 },
  "2038": { rating: 5.0, reviewCount: 147 },
  "2040": { rating: 4.7, reviewCount: 122 },
  "2041": { rating: 4.7, reviewCount: 320 },
  "2042": { rating: 4.8, reviewCount: 276 },
  "2043": { rating: 4.9, reviewCount: 306 },
  "2044": { rating: 4.5, reviewCount: 282 },
  "2046": { rating: 4.9, reviewCount: 191 },
  "2051": { rating: 4.7, reviewCount: 286 },
  "2052": { rating: 4.8, reviewCount: 295 },
  "2053": { rating: 4.5, reviewCount: 270 },
  "2054": { rating: 4.6, reviewCount: 235 },
  "2055": { rating: 4.8, reviewCount: 253 },
  "2056": { rating: 4.7, reviewCount: 123 },
  "2057": { rating: 4.7, reviewCount: 208 },
  "2059": { rating: 4.7, reviewCount: 226 },
  "2060": { rating: 4.9, reviewCount: 181 },
  "2061": { rating: 4.7, reviewCount: 167 },
  "2062": { rating: 4.9, reviewCount: 263 },
  "2063": { rating: 4.6, reviewCount: 183 },
  "2064": { rating: 4.6, reviewCount: 283 },
  "2065": { rating: 4.7, reviewCount: 166 },
  "2066": { rating: 4.9, reviewCount: 265 },
  "2067": { rating: 5.0, reviewCount: 182 },
  "2068": { rating: 4.7, reviewCount: 254 },
  "2070": { rating: 4.9, reviewCount: 251 },
  "2071": { rating: 5.0, reviewCount: 211 },
  "2072": { rating: 5.0, reviewCount: 117 },
  "2073": { rating: 4.8, reviewCount: 236 },
  "2074": { rating: 4.7, reviewCount: 110 },
  "2075": { rating: 4.9, reviewCount: 197 },
  "2077": { rating: 4.5, reviewCount: 318 },
  "2089": { rating: 4.7, reviewCount: 269 },
  "2091": { rating: 4.6, reviewCount: 307 },
  "2092": { rating: 4.8, reviewCount: 124 },
  "2093": { rating: 4.5, reviewCount: 285 },
  "2094": { rating: 5.0, reviewCount: 171 },
  "2096": { rating: 4.8, reviewCount: 186 },
  "2097": { rating: 4.8, reviewCount: 303 },
  "2098": { rating: 4.7, reviewCount: 257 },
  "2099": { rating: 4.9, reviewCount: 182 },
  "2100": { rating: 5.0, reviewCount: 245 },
  "2101": { rating: 4.9, reviewCount: 279 },
  "2102": { rating: 4.7, reviewCount: 223 },
  "2103": { rating: 4.5, reviewCount: 102 },
  "2104": { rating: 4.6, reviewCount: 260 },
  "2105": { rating: 5.0, reviewCount: 143 },
  "2106": { rating: 4.9, reviewCount: 196 },
  "2108": { rating: 5.0, reviewCount: 279 },
  "2109": { rating: 4.8, reviewCount: 308 },
  "2112": { rating: 4.6, reviewCount: 127 },
  "2115": { rating: 4.8, reviewCount: 316 },
  "2117": { rating: 4.5, reviewCount: 168 },
  "2118": { rating: 4.9, reviewCount: 160 },
  "2119": { rating: 4.7, reviewCount: 195 },
  "2120": { rating: 4.6, reviewCount: 220 },
  "2121": { rating: 4.7, reviewCount: 259 },
  "2122": { rating: 4.9, reviewCount: 128 },
  "2123": { rating: 4.6, reviewCount: 241 },
  "2125": { rating: 4.9, reviewCount: 243 },
  "2126": { rating: 4.8, reviewCount: 212 },
  "2127": { rating: 5.0, reviewCount: 121 },
  "2128": { rating: 4.6, reviewCount: 248 },
  "2130": { rating: 4.6, reviewCount: 150 },
  "2131": { rating: 4.8, reviewCount: 315 },
  "2132": { rating: 4.9, reviewCount: 315 },
  "2133": { rating: 4.6, reviewCount: 224 },
  "2134": { rating: 4.6, reviewCount: 198 },
  "2135": { rating: 5.0, reviewCount: 235 },
  "2136": { rating: 4.6, reviewCount: 193 },
  "2137": { rating: 4.8, reviewCount: 201 },
  "2138": { rating: 4.9, reviewCount: 135 },
  "2139": { rating: 5.0, reviewCount: 303 },
  "2140": { rating: 4.7, reviewCount: 145 },
  "2149": { rating: 4.7, reviewCount: 176 },
  "2150": { rating: 4.8, reviewCount: 264 },
  "2151": { rating: 4.6, reviewCount: 297 },
  "2152": { rating: 4.8, reviewCount: 155 },
  "2154": { rating: 4.5, reviewCount: 306 },
  "2155": { rating: 4.8, reviewCount: 275 },
  "2162": { rating: 5.0, reviewCount: 318 },
  "2163": { rating: 4.8, reviewCount: 212 },
  "2165": { rating: 4.9, reviewCount: 316 },
  "2166": { rating: 4.6, reviewCount: 289 },
  "2167": { rating: 4.6, reviewCount: 290 },
  "2168": { rating: 4.7, reviewCount: 247 },
  "2169": { rating: 4.6, reviewCount: 149 },
  "2170": { rating: 4.8, reviewCount: 269 },
  "2171": { rating: 4.9, reviewCount: 259 },
  "2173": { rating: 4.9, reviewCount: 245 },
  "2176": { rating: 4.5, reviewCount: 245 },
  "2177": { rating: 4.8, reviewCount: 164 },
  "2178": { rating: 4.9, reviewCount: 93 },
  "2179": { rating: 4.8, reviewCount: 272 },
  "2180": { rating: 4.6, reviewCount: 317 },
  "2181": { rating: 4.6, reviewCount: 276 },
  "2182": { rating: 4.7, reviewCount: 136 },
  "2183": { rating: 4.6, reviewCount: 223 },
  "2185": { rating: 4.9, reviewCount: 178 },
  "2187": { rating: 4.8, reviewCount: 318 },
  "2188": { rating: 4.6, reviewCount: 127 },
  "2189": { rating: 4.6, reviewCount: 296 },
  "2190": { rating: 5.0, reviewCount: 291 },
  "2191": { rating: 4.6, reviewCount: 307 },
  "2192": { rating: 4.7, reviewCount: 114 },
  "2194": { rating: 4.7, reviewCount: 104 },
  "2195": { rating: 4.6, reviewCount: 142 },
  "2196": { rating: 4.9, reviewCount: 270 },
  "2197": { rating: 4.8, reviewCount: 186 },
  "2198": { rating: 5.0, reviewCount: 290 },
  "2199": { rating: 4.8, reviewCount: 108 },
  "2201": { rating: 4.9, reviewCount: 88 },
  "2202": { rating: 4.6, reviewCount: 116 },
  "2203": { rating: 4.7, reviewCount: 257 },
  "2204": { rating: 4.9, reviewCount: 152 },
  "2206": { rating: 4.8, reviewCount: 295 },
  "2210": { rating: 4.8, reviewCount: 180 },
  "2211": { rating: 4.6, reviewCount: 144 },
  "2212": { rating: 4.7, reviewCount: 243 },
  "2213": { rating: 4.9, reviewCount: 228 },
  "2231": { rating: 4.7, reviewCount: 241 },
  "2232": { rating: 4.6, reviewCount: 101 },
  "2233": { rating: 4.8, reviewCount: 203 },
  "2234": { rating: 5.0, reviewCount: 162 },
  "2236": { rating: 4.8, reviewCount: 114 },
  "2237": { rating: 4.6, reviewCount: 94 },
  "2238": { rating: 4.7, reviewCount: 211 },
  "2239": { rating: 4.6, reviewCount: 145 },
  "2240": { rating: 4.9, reviewCount: 119 },
  "2241": { rating: 4.7, reviewCount: 179 },
  "2242": { rating: 4.8, reviewCount: 275 },
  "2244": { rating: 4.8, reviewCount: 223 },
  "2246": { rating: 4.7, reviewCount: 275 },
  "2247": { rating: 4.9, reviewCount: 311 },
  "2248": { rating: 4.7, reviewCount: 110 },
  "2249": { rating: 4.9, reviewCount: 242 },
  "2250": { rating: 4.7, reviewCount: 156 },
  "2251": { rating: 4.5, reviewCount: 179 },
  "2253": { rating: 4.6, reviewCount: 198 },
  "2255": { rating: 5.0, reviewCount: 303 },
  "2256": { rating: 4.7, reviewCount: 260 },
  "2258": { rating: 4.7, reviewCount: 315 },
  "2259": { rating: 5.0, reviewCount: 176 },
  "2260": { rating: 4.5, reviewCount: 155 },
  "2262": { rating: 4.6, reviewCount: 116 },
  "2263": { rating: 5.0, reviewCount: 295 },
  "2264": { rating: 4.7, reviewCount: 254 },
  "2265": { rating: 4.6, reviewCount: 248 },
  "2266": { rating: 4.8, reviewCount: 90 },
  "2267": { rating: 4.5, reviewCount: 170 },
  "2268": { rating: 4.6, reviewCount: 117 },
  "2269": { rating: 4.9, reviewCount: 137 },
  "2270": { rating: 4.5, reviewCount: 280 },
  "2271": { rating: 4.8, reviewCount: 235 },
  "2272": { rating: 4.6, reviewCount: 307 },
  "2273": { rating: 4.6, reviewCount: 283 },
  "2276": { rating: 4.6, reviewCount: 315 },
  "2277": { rating: 4.8, reviewCount: 155 },
  "2278": { rating: 4.9, reviewCount: 122 },
  "2280": { rating: 5.0, reviewCount: 223 },
  "2281": { rating: 4.6, reviewCount: 129 },
  "2283": { rating: 4.6, reviewCount: 306 },
  "2284": { rating: 4.5, reviewCount: 88 },
  "2286": { rating: 4.7, reviewCount: 286 },
  "2287": { rating: 4.6, reviewCount: 167 },
  "2288": { rating: 4.5, reviewCount: 152 },
  "2289": { rating: 4.5, reviewCount: 274 },
  "2290": { rating: 4.7, reviewCount: 114 },
  "2291": { rating: 4.9, reviewCount: 206 },
  "2292": { rating: 4.7, reviewCount: 177 },
  "2293": { rating: 4.8, reviewCount: 112 },
  "2294": { rating: 4.7, reviewCount: 141 },
  "2296": { rating: 5.0, reviewCount: 96 },
  "2297": { rating: 4.9, reviewCount: 317 },
  "2298": { rating: 4.9, reviewCount: 218 },
  "2299": { rating: 4.7, reviewCount: 249 },
  "2300": { rating: 5.0, reviewCount: 100 },
  "2303": { rating: 5.0, reviewCount: 301 },
  "2304": { rating: 4.7, reviewCount: 260 },
  "2305": { rating: 4.6, reviewCount: 267 },
  "2306": { rating: 5.0, reviewCount: 103 },
  "2307": { rating: 4.9, reviewCount: 167 },
  "2308": { rating: 4.8, reviewCount: 101 },
  "2309": { rating: 4.6, reviewCount: 244 },
  "2310": { rating: 4.8, reviewCount: 225 },
  "2313": { rating: 4.9, reviewCount: 182 },
  "2314": { rating: 5.0, reviewCount: 220 },
  "2315": { rating: 4.6, reviewCount: 214 },
  "2316": { rating: 4.8, reviewCount: 110 },
  "2317": { rating: 4.9, reviewCount: 114 },
  "2318": { rating: 4.9, reviewCount: 251 },
  "2319": { rating: 4.9, reviewCount: 226 },
  "2320": { rating: 4.9, reviewCount: 140 },
  "2321": { rating: 4.7, reviewCount: 312 },
  "2322": { rating: 4.6, reviewCount: 171 },
  "2324": { rating: 4.9, reviewCount: 187 },
  "2325": { rating: 4.7, reviewCount: 109 },
  "2326": { rating: 4.7, reviewCount: 165 },
  "2327": { rating: 4.8, reviewCount: 180 },
  "2328": { rating: 5.0, reviewCount: 260 },
  "2330": { rating: 5.0, reviewCount: 102 },
  "2331": { rating: 4.5, reviewCount: 106 },
  "2333": { rating: 4.5, reviewCount: 109 },
  "2334": { rating: 4.9, reviewCount: 180 },
  "2335": { rating: 4.9, reviewCount: 227 },
  "2336": { rating: 4.5, reviewCount: 228 },
  "2337": { rating: 4.8, reviewCount: 256 },
  "2338": { rating: 4.6, reviewCount: 175 },
  "2339": { rating: 4.9, reviewCount: 277 },
  "2343": { rating: 4.7, reviewCount: 319 },
  "2344": { rating: 4.9, reviewCount: 158 },
  "2345": { rating: 4.8, reviewCount: 175 },
  "2346": { rating: 4.6, reviewCount: 214 },
  "2347": { rating: 4.6, reviewCount: 253 },
  "2348": { rating: 4.7, reviewCount: 301 },
  "2349": { rating: 4.6, reviewCount: 301 },
  "2350": { rating: 4.8, reviewCount: 114 },
  "2351": { rating: 4.9, reviewCount: 231 },
  "2352": { rating: 4.6, reviewCount: 194 },
  "2353": { rating: 4.9, reviewCount: 281 },
  "2354": { rating: 4.9, reviewCount: 242 },
  "2355": { rating: 4.8, reviewCount: 227 },
  "2356": { rating: 4.5, reviewCount: 253 },
  "2357": { rating: 4.9, reviewCount: 153 },
  "2358": { rating: 4.5, reviewCount: 154 },
  "2359": { rating: 4.9, reviewCount: 164 },
  "2360": { rating: 5.0, reviewCount: 174 },
  "2361": { rating: 4.5, reviewCount: 307 },
  "2362": { rating: 4.6, reviewCount: 253 },
  "2363": { rating: 4.7, reviewCount: 121 },
  "2364": { rating: 4.9, reviewCount: 92 },
  "2365": { rating: 4.5, reviewCount: 220 },
  "2366": { rating: 4.6, reviewCount: 192 },
  "2367": { rating: 4.7, reviewCount: 125 },
  "2368": { rating: 4.7, reviewCount: 269 },
  "2369": { rating: 4.7, reviewCount: 230 },
  "2370": { rating: 4.8, reviewCount: 311 },
  "2371": { rating: 4.5, reviewCount: 125 },
  "2372": { rating: 4.9, reviewCount: 97 },
  "2373": { rating: 4.8, reviewCount: 154 },
  "2374": { rating: 4.7, reviewCount: 193 },
  "2375": { rating: 4.7, reviewCount: 198 },
  "2376": { rating: 4.7, reviewCount: 140 },
  "2377": { rating: 4.9, reviewCount: 114 },
  "2378": { rating: 4.7, reviewCount: 113 },
  "2379": { rating: 4.6, reviewCount: 258 },
  "2380": { rating: 4.8, reviewCount: 219 },
  "2381": { rating: 4.8, reviewCount: 96 },
  "2382": { rating: 4.6, reviewCount: 238 },
  "2383": { rating: 4.5, reviewCount: 137 },
  "2384": { rating: 4.7, reviewCount: 139 },
  "2385": { rating: 4.9, reviewCount: 280 },
  "2386": { rating: 4.6, reviewCount: 168 },
  "2387": { rating: 4.6, reviewCount: 212 },
  "2388": { rating: 4.9, reviewCount: 129 },
  "2389": { rating: 4.6, reviewCount: 221 },
  "2390": { rating: 4.9, reviewCount: 213 },
  "2391": { rating: 4.8, reviewCount: 256 },
  "2392": { rating: 4.9, reviewCount: 103 },
  "2393": { rating: 4.7, reviewCount: 274 },
  "2394": { rating: 4.5, reviewCount: 89 },
  "2395": { rating: 4.7, reviewCount: 104 },
  "2396": { rating: 4.9, reviewCount: 232 },
  "2397": { rating: 4.7, reviewCount: 188 },
  "2398": { rating: 4.9, reviewCount: 191 },
  "2399": { rating: 4.6, reviewCount: 188 },
  "2400": { rating: 4.5, reviewCount: 168 },
  "2401": { rating: 4.6, reviewCount: 243 },
  "2402": { rating: 4.7, reviewCount: 261 },
  "2403": { rating: 5.0, reviewCount: 107 },
  "2404": { rating: 4.7, reviewCount: 112 },
  "2405": { rating: 4.6, reviewCount: 235 },
  "2406": { rating: 4.7, reviewCount: 105 },
  "2407": { rating: 4.7, reviewCount: 164 },
  "2408": { rating: 4.9, reviewCount: 141 },
  "2409": { rating: 4.7, reviewCount: 128 },
  "2410": { rating: 4.5, reviewCount: 247 },
  "2411": { rating: 4.6, reviewCount: 215 },
  "2412": { rating: 4.6, reviewCount: 283 },
  "2413": { rating: 4.7, reviewCount: 271 },
  "2414": { rating: 5.0, reviewCount: 250 },
  "2415": { rating: 4.9, reviewCount: 145 },
  "2416": { rating: 4.6, reviewCount: 150 },
  "2417": { rating: 4.6, reviewCount: 239 },
  "2418": { rating: 4.6, reviewCount: 279 },
  "2419": { rating: 4.8, reviewCount: 130 },
  "2420": { rating: 5.0, reviewCount: 245 },
  "2421": { rating: 4.7, reviewCount: 278 },
  "2422": { rating: 4.8, reviewCount: 233 },
  "2423": { rating: 4.7, reviewCount: 310 },
  "2424": { rating: 4.8, reviewCount: 247 },
  "2425": { rating: 5.0, reviewCount: 167 },
  "2426": { rating: 4.9, reviewCount: 245 },
  "2427": { rating: 4.7, reviewCount: 197 },
  "2428": { rating: 4.5, reviewCount: 198 },
  "2429": { rating: 4.8, reviewCount: 288 },
  "2430": { rating: 4.6, reviewCount: 99 },
  "2431": { rating: 4.7, reviewCount: 103 },
  "2432": { rating: 4.7, reviewCount: 200 },
  "2433": { rating: 4.5, reviewCount: 179 },
  "2434": { rating: 4.9, reviewCount: 104 },
  "2435": { rating: 4.8, reviewCount: 303 },
  "2436": { rating: 4.5, reviewCount: 237 },
  "2437": { rating: 4.8, reviewCount: 203 },
  "2438": { rating: 4.8, reviewCount: 287 },
  "2439": { rating: 4.9, reviewCount: 95 },
  "2441": { rating: 4.7, reviewCount: 292 },
  "2442": { rating: 4.8, reviewCount: 133 },
  "2443": { rating: 4.7, reviewCount: 206 },
  "2444": { rating: 4.8, reviewCount: 100 },
  "2445": { rating: 4.7, reviewCount: 292 },
  "2446": { rating: 4.9, reviewCount: 172 },
  "2448": { rating: 5.0, reviewCount: 106 },
  "2449": { rating: 4.8, reviewCount: 129 },
  "2452": { rating: 4.5, reviewCount: 266 },
  "2453": { rating: 4.7, reviewCount: 197 },
  "2454": { rating: 4.8, reviewCount: 241 },
  "2455": { rating: 4.6, reviewCount: 180 },
  "2456": { rating: 5.0, reviewCount: 184 },
  "2457": { rating: 4.7, reviewCount: 171 },
  "2459": { rating: 4.8, reviewCount: 98 },
  "2460": { rating: 4.9, reviewCount: 250 },
  "2461": { rating: 4.7, reviewCount: 169 },
  "2462": { rating: 4.5, reviewCount: 258 },
  "2463": { rating: 4.7, reviewCount: 149 },
  "2464": { rating: 4.9, reviewCount: 253 },
  "2465": { rating: 5.0, reviewCount: 239 },
  "2466": { rating: 4.9, reviewCount: 170 },
  "2467": { rating: 4.5, reviewCount: 254 },
  "2468": { rating: 4.6, reviewCount: 174 },
  "2469": { rating: 4.7, reviewCount: 252 },
  "2470": { rating: 4.8, reviewCount: 185 },
  "2471": { rating: 4.6, reviewCount: 266 },
  "2472": { rating: 5.0, reviewCount: 164 },
  "2473": { rating: 4.8, reviewCount: 249 },
  "2474": { rating: 4.9, reviewCount: 293 },
  "2475": { rating: 4.6, reviewCount: 264 },
  "2476": { rating: 4.9, reviewCount: 274 },
  "2477": { rating: 5.0, reviewCount: 318 },
  "2478": { rating: 4.8, reviewCount: 250 },
  "2479": { rating: 4.8, reviewCount: 215 },
  "2480": { rating: 4.7, reviewCount: 177 },
  "2481": { rating: 4.7, reviewCount: 139 },
  "2482": { rating: 4.7, reviewCount: 281 },
  "2483": { rating: 4.7, reviewCount: 142 }
};

function initDefaultRatings() {
  for (const [salonId, data] of Object.entries(DEFAULT_SALON_RATINGS)) {
    stateCache.salonRatings[salonId] = {
      rating: data.rating,
      reviewCount: data.reviewCount,
      updatedAt: new Date().toISOString()
    };
  }
}