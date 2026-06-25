// src/dailyReportScheduler.js
// Naturals Salon — Daily Report Scheduler with PDF via PDFShift

import { getDailyStats } from "./database.js";
import { buildDailyReportHtml } from "./reportGenerator.js";
import { config } from "./config.js";
import { logWebhook, logWebhookError } from "./webhookLog.js";

const ADMIN_NUMBERS = new Set([
  process.env.ADMIN_WHATSAPP || "917708420110",
  "917904307757",
  "917708420110"
]);

// ── WhatsApp Helpers ──────────────────────────────────────────

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
  if (!res.ok) throw new Error(`WA text failed: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

async function uploadMediaBuffer(buffer, filename, mimeType) {
  const url = `https://graph.facebook.com/v22.0/${config.phoneNumberId}/media`;
  const form = new globalThis.FormData();
  form.append("messaging_product", "whatsapp");
  form.append("file", new globalThis.Blob([buffer], { type: mimeType }), filename);
  form.append("type", mimeType);

  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.whatsappToken}` },
    body: form
  });
  if (!res.ok) throw new Error(`Media upload failed: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return data.id;
}

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
      document: { id: mediaId, filename, caption }
    })
  });
  if (!res.ok) throw new Error(`WA document failed: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

// ── PDF Generation via PDFShift ───────────────────────────────

async function generatePdfFromHtml(html) {
  const apiKey = process.env.PDFSHIFT_API_KEY;
  if (!apiKey) throw new Error("PDFSHIFT_API_KEY not set");

  const credentials = Buffer.from(`api:${apiKey}`).toString("base64");

  const res = await fetch("https://api.pdfshift.io/v3/convert/pdf", {
    method: "POST",
    headers: {
      "Authorization": `Basic ${credentials}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      source: html,
      landscape: false,
      use_print: false,
      format: "A4",
      margin: { top: "10mm", right: "10mm", bottom: "10mm", left: "10mm" }
    })
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`PDFShift failed (${res.status}): ${err.slice(0, 300)}`);
  }

  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

// ── Beautiful WhatsApp Text Summary ──────────────────────────

function buildWhatsAppSummary(stats) {
  const {
    date, total, completed, pending, cancelled, noShow,
    walkIn, online, completionRate, pendingRate,
    cancelledRate, noShowRate, peakHour, peakCount,
    serviceBreakdown, staffBreakdown, topSalons
  } = stats;

  const dateObj = new Date(date + "T00:00:00");
  const dateFormatted = dateObj.toLocaleDateString("en-IN", {
    weekday: "long", day: "numeric", month: "long", year: "numeric"
  });

  function bar(pct) {
    const filled = Math.round(Number(pct) / 10);
    return "▓".repeat(filled) + "░".repeat(10 - filled);
  }

  const serviceLines = serviceBreakdown.slice(0, 5).map((s, i) =>
    `  ${i + 1}. ${s.name}\n     📋 ${s.total}  ✅ ${s.completed}  ⏳ ${s.pending}`
  ).join("\n") || "  No services today";

  const staffLines = staffBreakdown.slice(0, 5).map((s, i) =>
    `  ${i + 1}. 💇 ${s.name} — ${s.served} served (${s.completed} done)`
  ).join("\n") || "  No staff data";

  const salonLines = topSalons.slice(0, 3).map((s, i) =>
    `  ${i + 1}. 📍 ${s.name} — ${s.count} bookings`
  ).join("\n") || "  No data";

  const now = new Date().toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit", minute: "2-digit", hour12: true
  });

  return `╔══════════════════════════╗
║  📊 *NATURALS SALON*         ║
║  *Daily Business Report*     ║
╚══════════════════════════╝

🗓️ *${dateFormatted}*
🕐 Generated: ${now} IST

━━━━━━━━━━━━━━━━━━━━━━━━━━

📌 *BOOKING SUMMARY*

📋 Total Bookings   *${String(total).padStart(3)}*
✅ Completed        *${String(completed).padStart(3)}*
⏳ Pending          *${String(pending).padStart(3)}*
❌ Cancelled        *${String(cancelled).padStart(3)}*
👻 No Show          *${String(noShow).padStart(3)}*
🚶 Walk-ins         *${String(walkIn).padStart(3)}*
📱 Online (WA)      *${String(online).padStart(3)}*

━━━━━━━━━━━━━━━━━━━━━━━━━━

📊 *PERFORMANCE*

✅ Completion   ${bar(completionRate)} *${completionRate}%*
⏳ Pending      ${bar(pendingRate)} *${pendingRate}%*
❌ Cancelled    ${bar(cancelledRate)} *${cancelledRate}%*
👻 No Show      ${bar(noShowRate)} *${noShowRate}%*

🕐 Peak Hour: *${peakHour}*${peakCount > 0 ? ` (${peakCount} bookings)` : ""}

━━━━━━━━━━━━━━━━━━━━━━━━━━

💇 *TOP SERVICES*

${serviceLines}

━━━━━━━━━━━━━━━━━━━━━━━━━━

👩‍🔧 *STAFF PERFORMANCE*

${staffLines}

━━━━━━━━━━━━━━━━━━━━━━━━━━

🏪 *TOP SALONS TODAY*

${salonLines}

━━━━━━━━━━━━━━━━━━━━━━━━━━
_🤖 Auto-generated · No customer data_
_📄 PDF report attached above_`;
}

// ── Core Report Sender ────────────────────────────────────────

export async function sendDailyReport(dateStr) {
  const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;
  const today = dateStr || new Date(Date.now() + IST_OFFSET_MS).toISOString().slice(0, 10);

  logWebhook("daily_report", `building report for ${today}`);

  const stats = getDailyStats(today);
  const summaryText = buildWhatsAppSummary(stats);
  const filename = `naturals-report-${today}.pdf`;

  // Try PDF generation
  let pdfBuffer = null;
  let pdfMediaId = null;

  if (process.env.PDFSHIFT_API_KEY) {
    try {
      const html = buildDailyReportHtml(stats);
      logWebhook("daily_report", "generating PDF via PDFShift...");
      pdfBuffer = await generatePdfFromHtml(html);
      logWebhook("daily_report", `PDF generated: ${pdfBuffer.length} bytes`);
    } catch (pdfErr) {
      logWebhookError("daily_report PDF generation", pdfErr);
    }

    if (pdfBuffer) {
      try {
        pdfMediaId = await uploadMediaBuffer(pdfBuffer, filename, "application/pdf");
        logWebhook("daily_report", `PDF uploaded: media_id=${pdfMediaId}`);
      } catch (uploadErr) {
        logWebhookError("daily_report PDF upload", uploadErr);
      }
    }
  } else {
    logWebhook("daily_report", "PDFSHIFT_API_KEY not set — text only");
  }

  // Send to all admins
  for (const adminNum of ADMIN_NUMBERS) {
    try {
      // Send PDF first if available
      if (pdfMediaId) {
        await sendWhatsAppDocument(
          adminNum,
          pdfMediaId,
          filename,
          `📄 Naturals Salon Daily Report — ${today}`
        );
        logWebhook("daily_report", `PDF sent to ${adminNum}`);
      }

      // Always send text summary
      await sendWhatsAppText(adminNum, summaryText);
      logWebhook("daily_report", `summary sent to ${adminNum}`);

    } catch (sendErr) {
      logWebhookError(`daily_report send to ${adminNum}`, sendErr);
    }
  }

  logWebhook("daily_report", `done for ${today} total=${stats.total}`);
  return stats;
}

// ── Scheduler ────────────────────────────────────────────────

export function startDailyReportScheduler() {
  tryStartWithCron();
}

async function tryStartWithCron() {
  try {
    const cron = await import("node-cron");
    // 9:00 PM IST = 15:30 UTC
    const schedule = process.env.REPORT_CRON || "30 15 * * *";

    cron.default.schedule(schedule, async () => {
      console.log("[scheduler] Daily report triggered at", new Date().toISOString());
      try {
        const stats = await sendDailyReport();
        console.log(`[scheduler] Done — total=${stats.total} date=${stats.date}`);
      } catch (err) {
        logWebhookError("scheduler daily_report", err);
      }
    }, { timezone: "UTC" });

    console.log(`[scheduler] Daily report scheduled: ${schedule} UTC (9 PM IST)`);
  } catch (cronErr) {
    console.warn("[scheduler] node-cron unavailable, using setTimeout:", cronErr.message);
    scheduleWithTimeout();
  }
}

function scheduleWithTimeout() {
  function msUntilNext9PMIST() {
    const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;
    const istNow = new Date(Date.now() + IST_OFFSET_MS);
    const target = new Date(istNow);
    target.setHours(21, 0, 0, 0);
    if (target <= istNow) target.setDate(target.getDate() + 1);
    return target.getTime() - istNow.getTime();
  }

  function scheduleNext() {
    const ms = msUntilNext9PMIST();
    console.log(`[scheduler] Next report in ${(ms / 3600000).toFixed(1)}h`);
    setTimeout(async () => {
      try {
        const stats = await sendDailyReport();
        console.log(`[scheduler] Done — total=${stats.total}`);
      } catch (err) {
        logWebhookError("scheduler daily_report (timeout)", err);
      } finally {
        scheduleNext();
      }
    }, ms);
  }
  scheduleNext();
}