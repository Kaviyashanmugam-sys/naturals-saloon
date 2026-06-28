import { config } from "./config.js";

const DEFAULT_HEADERS = {
  Accept: "*/*",
  "Content-Type": "application/json",
  Origin: "https://ntlivewebapi.innosmarti.com",
  Referer: "https://ntlivewebapi.innosmarti.com/booking/"
};

const salonCache = new Map();
let allStoresCache = null;

function toGenderId(gender) {
  return String(gender || "").toLowerCase() === "male" ? 1 : 2;
}

function apiUrl(path) {
  return `${config.gtlApiBaseUrl.replace(/\/$/, "")}${path}`;
}

function decodeBody(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function normalizeSalon(row) {
  const id = String(row?.StoreID ?? row?.StoreId ?? row?.id ?? "").trim();
  if (!id) return null;

  const lat = Number(row?.Latitude ?? row?.lat ?? row?.latitude);
  const lng = Number(row?.Longitude ?? row?.lng ?? row?.longitude);
  const storeName = String(row?.StoreName ?? row?.name ?? "").trim();
  const areaFromName = storeName.includes("-") ? storeName.split("-").slice(1).join("-").trim() : "";
  const rawAddress = String(row?.Address ?? row?.AddressLine1 ?? "").trim();
  const phoneMatch = rawAddress.match(/[,.\s]*Phone\s*[:\-]?\s*([\d\s]+)$/i);
  const rawPhone = String(row?.Phone ?? row?.PhoneNo ?? row?.ContactNo ?? phoneMatch?.[1] ?? "").replace(/\s+/g, "").trim();
  const phone = rawPhone === "0" || rawPhone === "0.0" ? "" : rawPhone;
  const addressText = phoneMatch ? rawAddress.slice(0, rawAddress.length - phoneMatch[0].length).replace(/[,.\s]+$/, "").trim() : rawAddress;
  const cityMatch = addressText.match(/,\s*([A-Za-z\s]+)\s*-\s*\d{6}\b/);
  const pinMatch = addressText.match(/\b(\d{6})\b/);
  const area = String(row?.Area ?? row?.Locality ?? row?.Location ?? areaFromName).trim();
  const city = String(row?.City ?? cityMatch?.[1] ?? "").trim().toUpperCase();
  const pincode = String(row?.PinCode ?? row?.Pincode ?? row?.ZipCode ?? pinMatch?.[1] ?? "").trim();
  const name = String(row?.StoreName ?? row?.name ?? `Naturals - ${area || city || id}`).trim();
  const addressLine1 = String(addressText || [area, city, pincode].filter(Boolean).join(", ")).trim();
  const distanceKmRaw = Number(row?.DistanceKM ?? row?.distanceKm ?? row?.distance);

  const latFin = Number.isFinite(lat) && lat !== 0 ? lat : null;
  const lngFin = Number.isFinite(lng) && lng !== 0 ? lng : null;

  // Build maps URL — prefer GoogleLocation from API, fallback to coordinates
  const rawMapsUrl = String(row?.GoogleLocation ?? row?.mapsUrl ?? row?.MapURL ?? "").trim();
  const mapsUrl = (rawMapsUrl && !rawMapsUrl.includes("null"))
    ? rawMapsUrl
    : (latFin != null && lngFin != null)
      ? `https://maps.google.com/?q=${latFin},${lngFin}`
      : "";

  // Rating & review count — use API values if present, else defaults
  const ratingRaw = Number(row?.Rating ?? row?.rating ?? row?.AvgRating ?? row?.avgRating ?? 0);
  const rating = ratingRaw > 0 ? Number(ratingRaw.toFixed(1)) : 4.9;
  const reviewCountRaw = Number(row?.ReviewCount ?? row?.reviewcount ?? row?.TotalReviews ?? row?.totalReviews ?? 0);
  const reviewCount = reviewCountRaw > 0 ? reviewCountRaw : 170;

  return {
    id,
    name,
    area,
    city,
    pincode,
    phone,
    addressLine1,
    mapsUrl,
    lat: latFin,
    lng: lngFin,
    distanceKm: Number.isFinite(distanceKmRaw) ? Number(distanceKmRaw.toFixed(2)) : null,
    rating,
    reviewCount
  };
}

async function postJson(path, payload) {
  const headers = { ...DEFAULT_HEADERS };
  if (config.gtlApiAuth) headers.Authorization = config.gtlApiAuth;
  if (config.gtlApiCookie) headers.Cookie = config.gtlApiCookie;

  if (
    path === "/api/storedetailsforaptbystoreid" ||
    path === "/api/getemployeeforappointment" ||
    path === "/api/getappointmentcategory" ||
    path === "/api/addToCalendar"
  ) {
    console.log(`[gtlApi] request ${path}`, JSON.stringify(payload));
  }

  const response = await fetch(apiUrl(path), {
    method: "POST",
    headers,
    body: JSON.stringify(payload)
  });
  const raw = await response.text();
  const parsed = decodeBody(raw);
  if (
    path === "/api/storedetailsforaptbystoreid" ||
    path === "/api/getemployeeforappointment" ||
    path === "/api/getappointmentcategory" ||
    path === "/api/addToCalendar"
  ) {
    console.log(`[gtlApi] response ${path} status=`, response.status);
    console.log(`[gtlApi] response ${path} body=`, raw.slice(0, 4000));
  }
  if (!response.ok) {
    throw new Error(`API ${path} failed (${response.status}): ${raw.slice(0, 300)}`);
  }
  return parsed;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

async function fetchAllStores() {
  if (allStoresCache !== null && allStoresCache.length > 0) return allStoresCache;
  const res = await postJson("/api/storedetailsforaptbystoreid", {
    orgid: config.gtlOrgId
  });
  const rows = asArray(res?.data ?? res);
  const salons = rows.map(normalizeSalon).filter(Boolean);
  salons.forEach((s) => salonCache.set(s.id, s));
  allStoresCache = salons;
  console.log("[gtlApi] all stores fetched and cached count=", salons.length);
  return salons;
}

export async function fetchStoresByLocation({ lat, lng }) {
  const salons = await fetchAllStores();
  console.log("[gtlApi] normalized salons (location) count=", salons.length);

  // Filter salons with valid coordinates only
  const withCoords = salons.filter(s => s.lat != null && s.lng != null);

  // Sort by distance from user location
  function distKm(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon/2) * Math.sin(dLon/2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  }

  const sorted = withCoords
    .map(s => ({ ...s, distanceKm: Number(distKm(lat, lng, s.lat, s.lng).toFixed(1)) }))
    .sort((a, b) => a.distanceKm - b.distanceKm);

  // Return nearest 10
  const nearest = sorted.slice(0, 10);
  console.log("[gtlApi] nearest salons:", nearest.slice(0, 3).map(s => `${s.name} (${s.distanceKm}km)`).join(", "));
  return nearest;
}

export async function fetchStoresByPincode(pincode) {
  const q = String(pincode || "").trim();
  const salons = await fetchAllStores();
  const byPin = salons.filter((s) => s.pincode === q);
  if (byPin.length > 0) {
    console.log("[gtlApi] normalized salons (pincode exact) count=", byPin.length);
    return byPin;
  }
  const filtered = salons.filter((s) => s.addressLine1.toLowerCase().includes(q.toLowerCase()));
  console.log("[gtlApi] normalized salons (pincode address fallback) count=", filtered.length);
  return filtered;
}

// ─── FIXED: Proper city/area search that respects location ───
export async function fetchStoresBySearchText(searchText) {
  const q = String(searchText || "").trim();
  const salons = await fetchAllStores();

  // Normalize search query for comparison
  const qLower = q.toLowerCase().replace(/[^a-z0-9\s]/g, "").trim();

  // City aliases — map common names to what appears in the data
  const CITY_ALIASES = {
    "bangalore": ["bangalore", "bengaluru", "bengalore"],
    "bengaluru": ["bangalore", "bengaluru", "bengalore"],
    "chennai": ["chennai", "madras"],
    "mumbai": ["mumbai", "bombay"],
    "delhi": ["delhi", "new delhi"],
    "hyderabad": ["hyderabad", "secunderabad"],
    "pune": ["pune", "poona"],
    "kolkata": ["kolkata", "calcutta"],
    "coimbatore": ["coimbatore", "kovai"],
  };

  // Get all aliases for the search query
  const searchAliases = CITY_ALIASES[qLower] || [qLower];

  // Escape for regex
  const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  // Score each salon — higher score = better match
  const scored = salons.map((s) => {
    const cityLower = (s.city || "").toLowerCase().replace(/[^a-z0-9\s]/g, "");
    const areaLower = (s.area || "").toLowerCase().replace(/[^a-z0-9\s]/g, "");
    const nameLower = (s.name || "").toLowerCase().replace(/[^a-z0-9\s]/g, "");
    const addressLower = (s.addressLine1 || "").toLowerCase().replace(/[^a-z0-9\s]/g, "");

    let score = 0;

    for (const alias of searchAliases) {
      const re = new RegExp(`\\b${escapeRegex(alias)}\\b`, "i");

      // City match = highest priority (50 pts)
      if (re.test(cityLower)) { score += 50; break; }

      // Area match = high priority (30 pts)
      if (re.test(areaLower)) { score += 30; break; }

      // Name match (20 pts)
      if (re.test(nameLower)) { score += 20; break; }

      // Address match (10 pts)
      if (re.test(addressLower)) { score += 10; break; }

      // Partial word match as fallback (5 pts)
      if (cityLower.includes(alias) || areaLower.includes(alias)) { score += 5; break; }
    }

    return { salon: s, score };
  });

  // Filter out 0 score, sort by score desc
  const filtered = scored
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .map(x => x.salon);

  console.log("[gtlApi] search='%s' aliases=%j matched=%d", q, searchAliases, filtered.length);

  // Log first few results for debugging
  if (filtered.length > 0) {
    console.log("[gtlApi] top results:", filtered.slice(0, 3).map(s => `${s.name} (${s.city})`).join(", "));
  }

  return filtered;
}

export async function fetchCategoriesForGender(gender) {
  const rows = asArray(await postJson("/api/getappointmentcategory", { OrganisationID: config.gtlOrgId }));
  const gid = toGenderId(gender);
  const EXCLUDED_CATEGORIES = ["bleach"];

  const mapped = rows
    .filter((r) => {
      const rg = Number(r?.GenderID ?? r?.genderid ?? r?.Gender);
      return !Number.isFinite(rg) || rg === gid;
    })
    .filter((r) => {
      const title = String(r?.AptCategory ?? r?.Category ?? r?.CategoryName ?? r?.categoryname ?? r?.title ?? "").trim().toLowerCase();
      return !EXCLUDED_CATEGORIES.includes(title);
    })
    .map((r) => {
      const title = String(
        r?.AptCategory ??
          r?.Category ??
          r?.CategoryName ??
          r?.categoryname ??
          r?.title ??
          r?.text ??
          r?.ServiceCategory ??
          ""
      ).trim();
      let id = String(
        r?.AptCategoryID ?? r?.CategoryID ?? r?.categoryid ?? r?.id ?? r?.value ?? ""
      ).trim();
      if (!id && title) {
        id = title.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
      }
      return id && title ? { id, title } : null;
    })
    .filter(Boolean);
  console.log("[gtlApi] normalized categories count=", mapped.length);
  return mapped;
}

export async function fetchStylists({ storeId, aptDate, gender }) {
  const rows = asArray(
    await postJson("/api/getemployeeforappointment", {
      StoreID: Number(storeId),
      OrganisationID: config.gtlOrgId,
      AptDate: aptDate,
      GenderID: toGenderId(gender)
    })
  );
  console.log("[gtlApi] stylists", rows);
  return rows
    .map((r) => {
      const id = String(r?.EmpID ?? r?.empid ?? r?.id ?? "").trim();
      const name = String(r?.Employee ?? r?.FirstName ?? r?.text ?? "").trim();
      const designation = String(r?.DesignationName ?? r?.designation ?? "").trim();
      const displayTitle = designation ? `${name} — ${designation}` : name;
      return id && name ? { id, name, designation, displayTitle } : null;
    })
    .filter(Boolean);
}

function formatTimeSlot(start, end) {
  const s = String(start || "").trim();
  const e = String(end || "").trim();
  if (!s) return "";
  return e ? `${s} - ${e}` : s;
}

function time24ToMinutes(value) {
  const m = String(value || "")
    .trim()
    .match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (!Number.isFinite(hh) || !Number.isFinite(mm) || hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return hh * 60 + mm;
}

function minutesToTime12(total) {
  const hh24 = Math.floor(total / 60);
  const mm = total % 60;
  const ampm = hh24 >= 12 ? "PM" : "AM";
  const hh12 = hh24 % 12 === 0 ? 12 : hh24 % 12;
  return `${String(hh12).padStart(2, "0")}:${String(mm).padStart(2, "0")} ${ampm}`;
}

export async function fetchSlots({ storeId, aptDate, empId }) {
  const raw = await postJson("/api/getemployeeforappointmentslot", {
    StoreID: Number(storeId),
    OrganisationID: config.gtlOrgId,
    AptDate: aptDate,
    EmpID: String(empId || "")
  });
  console.log("[gtlApi] slot raw response", raw);
  const rows = asArray(raw);

  const exact = rows
    .map((r) => formatTimeSlot(r?.starttime, r?.endtime))
    .filter(Boolean)
    .map((id) => ({ id, title: id }));
  if (exact.length) return exact;

  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const rangeStart = time24ToMinutes(raw.start);
    const rangeEnd = time24ToMinutes(raw.end);
    if (rangeStart != null && rangeEnd != null && rangeEnd > rangeStart) {
      const generated = [];
      for (let cur = rangeStart; cur <= rangeEnd - 30; cur += 30) {
        const label = minutesToTime12(cur);
        generated.push({ id: label, title: label });
      }
      if (generated.length) return generated;
    }
  }

  const fallback = [];
  for (let h = 10; h < 20; h += 1) {
    for (const mm of ["00", "30"]) {
      const ampm = h >= 12 ? "PM" : "AM";
      const h12 = h % 12 === 0 ? 12 : h % 12;
      const title = `${String(h12).padStart(2, "0")}:${mm} ${ampm}`;
      fallback.push({ id: title, title });
    }
  }
  return fallback;
}

export async function createAppointment(payload) {
  const response = await postJson("/api/addToCalendar", payload);
  const result = String(response?.result || response?.status || "").toLowerCase();
  if (result === "error") {
    const message = String(response?.message || "unknown addToCalendar error");
    throw new Error(`addToCalendar rejected: ${message}`);
  }
  return response;
}

export function getSalonFromCache(salonId) {
  return salonCache.get(String(salonId || ""));
}
