// src/dailyReportScheduler.js
// Naturals Salon — Daily Report Scheduler
// Sends HTML report to admin numbers every day at 9:00 PM IST
// Uses node-cron for scheduling; falls back to setTimeout if cron unavailable

import { getDailyStats } from "./database.js";
import { buildReportBuffer } from "./reportGenerator.js";
import { config } from "./config.js";
import { logWebhook, logWebhookError } from "./webhookLog.js";

const ADMIN_NUMBERS = new Set([
  process.env.ADMIN_WHATSAPP || "917708420110",
  "917904307757",
  "917708420110"
]);

// ── WhatsApp send helpers ─────────────────────────────────────

async function sendWhatsAppText(to, body) {
  const url = `https://graph.facebook.com/v22.0/${config.phoneNumberId}/messages`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.whatsappToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body }
    })
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`WhatsApp text failed: ${err.slice(0, 200)}`);
  }
  return res.json();
}

// Upload media (HTML file as document) → get media_id
async function uploadReportMedia(htmlBuffer, filename) {
  const url = `https://graph.facebook.com/v22.0/${config.phoneNumberId}/media`;

  // Build multipart form
  const { FormData, Blob } = await import("node:buffer").catch(() => {
    // Fallback for older Node — use global
    return { FormData: global.FormData, Blob: global.Blob };
  });

  // Use native fetch FormData (Node 18+)
  const form = new globalThis.FormData();
  form.append("messaging_product", "whatsapp");
  form.append(
    "file",
    new globalThis.Blob([htmlBuffer], { type: "text/html" }),
    filename
  );
  form.append("type", "text/html");

  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.whatsappToken}` },
    body: form
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Media upload failed: ${err.slice(0, 200)}`);
  }
  const data = await res.json();
  return data.id; // media_id
}

// Send document via media_id
async function sendWhatsAppDocument(to, mediaId, filename, caption) {
  const url = `https://graph.facebook.com/v22.0/${config.phoneNumberId}/messages`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.whatsappToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "document",
      document: {
        id: mediaId,
        filename,
        caption
      }
    })
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`WhatsApp document failed: ${err.slice(0, 200)}`);
  }
  return res.json();
}

// ── Core report sender ────────────────────────────────────────

export async function sendDailyReport(dateStr) {
  const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;
  const today = dateStr || new Date(Date.now() + IST_OFFSET_MS).toISOString().slice(0, 10);

  logWebhook("daily_report", `building report for ${today}`);

  const stats = getDailyStats(today);
  const htmlBuffer = buildReportBuffer(stats);
  const filename = `naturals-report-${today}.html`;

  const summaryText =
    `📊 *Naturals Salon — Daily Business Report*\n` +
    `🗓️ *Date:* ${today}\n\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    `📋 *Total Bookings:* ${stats.total}\n` +
    `✅ *Completed:* ${stats.completed} (${stats.completionRate}%)\n` +
    `⏳ *Pending:* ${stats.pending} (${stats.pendingRate}%)\n` +
    `❌ *Cancelled:* ${stats.cancelled}\n` +
    `👻 *No Show:* ${stats.noShow}\n` +
    `🚶 *Walk-ins:* ${stats.walkIn}\n` +
    `📱 *Online (WhatsApp):* ${stats.online}\n` +
    `🕐 *Peak Hour:* ${stats.peakHour}\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    `_Full report attached as HTML file. Open in browser for best view._`;

  let mediaId = null;
  try {
    mediaId = await uploadReportMedia(htmlBuffer, filename);
    logWebhook("daily_report", `media uploaded id=${mediaId}`);
  } catch (uploadErr) {
    logWebhookError("daily_report media upload", uploadErr);
  }

  for (const adminNum of ADMIN_NUMBERS) {
    try {
      // Always send text summary
      await sendWhatsAppText(adminNum, summaryText);
      logWebhook("daily_report", `text summary sent to ${adminNum}`);

      // Send HTML file if upload succeeded
      if (mediaId) {
        await sendWhatsAppDocument(
          adminNum,
          mediaId,
          filename,
          `Naturals Salon Daily Report — ${today}`
        );
        logWebhook("daily_report", `HTML report sent to ${adminNum}`);
      }
    } catch (sendErr) {
      logWebhookError(`daily_report send to ${adminNum}`, sendErr);
    }
  }

  logWebhook("daily_report", `done for ${today}`);
  return stats;
}

// ── Scheduler ────────────────────────────────────────────────

export function startDailyReportScheduler() {
  // Try node-cron first
  tryStartWithCron();
}

async function tryStartWithCron() {
  try {
    const cron = await import("node-cron");

    // 9:00 PM IST = 15:30 UTC (IST is UTC+5:30)
    // Cron: second minute hour day month weekday
    // "30 15 * * *" = every day at 15:30 UTC = 9:00 PM IST
    const schedule = process.env.REPORT_CRON || "30 15 * * *";

    if (!cron.default.validate(schedule)) {
      console.warn("[scheduler] Invalid REPORT_CRON:", schedule, "— using default 9PM IST");
    }

    cron.default.schedule(schedule, async () => {
      console.log("[scheduler] Daily report triggered at", new Date().toISOString());
      try {
        const stats = await sendDailyReport();
        console.log(`[scheduler] Report sent — total=${stats.total} date=${stats.date}`);
      } catch (err) {
        logWebhookError("scheduler daily_report", err);
      }
    }, { timezone: "UTC" });

    console.log(`[scheduler] Daily report scheduled: ${schedule} UTC (9 PM IST)`);
  } catch (cronErr) {
    console.warn("[scheduler] node-cron not available, using setTimeout fallback:", cronErr.message);
    scheduleWithTimeout();
  }
}

function scheduleWithTimeout() {
  function msUntilNext9PMIST() {
    const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;
    const now = new Date();
    const istNow = new Date(now.getTime() + IST_OFFSET_MS);
    const target = new Date(istNow);
    target.setHours(21, 0, 0, 0); // 9 PM
    if (target <= istNow) target.setDate(target.getDate() + 1);
    return target.getTime() - istNow.getTime();
  }

  function scheduleNext() {
    const ms = msUntilNext9PMIST();
    const hours = (ms / 3600000).toFixed(1);
    console.log(`[scheduler] Next report in ${hours}h (setTimeout fallback)`);
    setTimeout(async () => {
      try {
        const stats = await sendDailyReport();
        console.log(`[scheduler] Report sent — total=${stats.total} date=${stats.date}`);
      } catch (err) {
        logWebhookError("scheduler daily_report (timeout)", err);
      } finally {
        scheduleNext(); // reschedule for next day
      }
    }, ms);
  }

  scheduleNext();
}