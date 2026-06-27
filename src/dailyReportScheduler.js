
import { getDailyStats } from "./database.js";
import { buildDailyReportHtml } from "./reportGenerator.js";
import { config } from "./config.js";
import { logWebhook, logWebhookError } from "./webhookLog.js";
import { readFileSync } from "fs";

// ─── ADMIN NUMBER ────────────────────────────────────────────
const ADMIN_NUMBER = process.env.ADMIN_WHATSAPP || "917904307757";

// ─── Get PDFShift key — env var OR secret file ───────────────
function getPdfShiftKey() {
  if (process.env.PDFSHIFT_API_KEY) {
    console.log("[pdfshift] key from env var OK");
    return process.env.PDFSHIFT_API_KEY;
  }
  const secretPaths = [
    "/etc/secrets/PDFSHIFT_API_KEY",
    "/etc/secrets/PDFSHIFT_API_KEY.txt",
  ];
  for (const p of secretPaths) {
    try {
      const val = readFileSync(p, "utf8").trim();
      if (val) {
        console.log("[pdfshift] key from secret file:", p);
        return val;
      }
    } catch {}
  }
  if (process.env.PDFSHIFT_API_KEY) return process.env.PDFSHIFT_API_KEY;
  console.error("[pdfshift] key NOT FOUND anywhere!");
  return null;
}

// ─── WhatsApp Media Helpers ──────────────────────────────────
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

async function sendWhatsAppDocument(to, mediaId, filename) {
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
      document: { id: mediaId, filename }
    })
  });
  if (!res.ok) throw new Error(`WA document failed: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

// ─── PDF Generation via PDFShift ─────────────────────────────
async function generatePdfFromHtml(html) {
  const apiKey = getPdfShiftKey();
  if (!apiKey) throw new Error("PDFSHIFT_API_KEY not set — cannot generate PDF");

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
  return Buffer.from(await res.arrayBuffer());
}

// ─── Core Report Sender ───────────────────────────────────────
export async function sendDailyReport(dateStr) {
  const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;
  const today = dateStr || new Date(Date.now() + IST_OFFSET_MS).toISOString().slice(0, 10);
  logWebhook("daily_report", `building PDF report for ${today}`);

  const apiKey = getPdfShiftKey();
  if (!apiKey) throw new Error("PDFSHIFT_API_KEY not set — cannot generate PDF");

  const stats = await getDailyStats(today);
  logWebhook("daily_report", `stats: total=${stats.total} date=${stats.date}`);

  const filename = `naturals-report-${today}.pdf`;
  const html = buildDailyReportHtml(stats);
  const pdfBuffer = await generatePdfFromHtml(html);
  logWebhook("daily_report", `PDF generated: ${pdfBuffer.length} bytes`);

  const pdfMediaId = await uploadMediaBuffer(pdfBuffer, filename, "application/pdf");
  logWebhook("daily_report", `PDF uploaded: media_id=${pdfMediaId}`);

  await sendWhatsAppDocument(ADMIN_NUMBER, pdfMediaId, filename);
  logWebhook("daily_report", `PDF sent to ${ADMIN_NUMBER}`);

  return stats;
}

// ─── Scheduler (9 PM IST = 15:30 UTC) ────────────────────────
export function startDailyReportScheduler() {
  tryStartWithCron();
}

async function tryStartWithCron() {
  try {
    const cron = await import("node-cron");
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
    console.warn("[scheduler] node-cron unavailable:", cronErr.message);
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
