// src/reportGenerator.js
// Naturals Salon — Premium PDF Report with Logo + Light Green Theme

export function buildDailyReportHtml(stats) {
  const {
    date, total, completed, pending, cancelled, noShow,
    walkIn, online, completionRate, peakHour, peakCount,
    serviceBreakdown, staffBreakdown, topSalons
  } = stats;

  const dateObj = new Date(date + "T00:00:00");
  const dateFormatted = dateObj.toLocaleDateString("en-IN", {
    weekday: "long", day: "numeric", month: "long", year: "numeric"
  });
  const generatedAt = new Date().toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: true
  });

  const serviceRows = (serviceBreakdown || []).slice(0, 8).map((s, i) => `
    <tr class="${i % 2 === 0 ? 'even' : ''}">
      <td>${escHtml(s.name)}</td>
      <td class="num">${s.total}</td>
      <td class="num c-green">${s.completed}</td>
      <td class="num c-orange">${s.pending}</td>
    </tr>`).join("") || `<tr><td colspan="4" class="empty">No service data for today</td></tr>`;

  const staffRows = (staffBreakdown || []).slice(0, 8).map((s, i) => `
    <tr class="${i % 2 === 0 ? 'even' : ''}">
      <td>${escHtml(s.name)}</td>
      <td class="num">${s.served}</td>
      <td class="num c-green">${s.completed}</td>
    </tr>`).join("") || `<tr><td colspan="3" class="empty">No staff data for today</td></tr>`;

  const salonRows = (topSalons || []).slice(0, 10).map((s, i) => `
    <tr class="${i % 2 === 0 ? 'even' : ''}">
      <td>${escHtml(s.name)}</td>
      <td class="num">${s.count}</td>
    </tr>`).join("") || `<tr><td colspan="2" class="empty">No salon data for today</td></tr>`;

  // Naturals logo SVG (N letter in green circle - matches brand)
  const logoSvg = `<svg width="52" height="52" viewBox="0 0 52 52" xmlns="http://www.w3.org/2000/svg">
    <circle cx="26" cy="26" r="26" fill="#1a7a3c"/>
    <text x="26" y="35" font-family="Arial,sans-serif" font-size="28" font-weight="900"
      text-anchor="middle" fill="#ffffff" letter-spacing="-1">N</text>
  </svg>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Naturals Salon — Daily Report — ${escHtml(date)}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: 'Segoe UI', Arial, sans-serif;
    background: #f0f7f2;
    color: #1a1a1a;
    padding: 0;
    font-size: 13px;
    line-height: 1.5;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  /* ── HEADER ── */
  .header {
    background: linear-gradient(135deg, #1a7a3c 0%, #0f5229 100%);
    padding: 28px 36px 24px;
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .header-left { display: flex; align-items: center; gap: 16px; }
  .brand-name { font-size: 26px; font-weight: 800; color: #fff; letter-spacing: 1px; }
  .brand-sub { font-size: 12px; color: rgba(255,255,255,0.7); letter-spacing: 2px; text-transform: uppercase; margin-top: 2px; }
  .header-right { text-align: right; }
  .report-title { font-size: 13px; color: rgba(255,255,255,0.7); letter-spacing: 1px; text-transform: uppercase; }
  .report-date { font-size: 17px; font-weight: 700; color: #fff; margin-top: 4px; }
  .report-gen { font-size: 11px; color: rgba(255,255,255,0.55); margin-top: 3px; }

  /* ── BODY ── */
  .body { padding: 28px 36px; }

  /* ── SECTION TITLE ── */
  .sec-title {
    font-size: 11px;
    font-weight: 700;
    color: #1a7a3c;
    text-transform: uppercase;
    letter-spacing: 1.5px;
    margin: 24px 0 12px;
    padding-bottom: 6px;
    border-bottom: 2px solid #c8e6d0;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .sec-title::before {
    content: '';
    display: inline-block;
    width: 4px;
    height: 14px;
    background: #1a7a3c;
    border-radius: 2px;
  }

  /* ── KPI GRID ── */
  .kpi-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 10px;
    margin-bottom: 6px;
  }
  .kpi {
    background: #fff;
    border: 1px solid #d4eadb;
    border-top: 3px solid #1a7a3c;
    border-radius: 6px;
    padding: 14px 12px;
    text-align: center;
  }
  .kpi.amber { border-top-color: #e08c00; }
  .kpi.red   { border-top-color: #c0392b; }
  .kpi.blue  { border-top-color: #2471a3; }
  .kpi-label { font-size: 10px; color: #777; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 6px; }
  .kpi-value { font-size: 28px; font-weight: 800; color: #1a7a3c; line-height: 1; }
  .kpi.amber .kpi-value { color: #e08c00; }
  .kpi.red   .kpi-value { color: #c0392b; }
  .kpi.blue  .kpi-value { color: #2471a3; }
  .kpi-sub { font-size: 10px; color: #999; margin-top: 4px; }

  /* ── PEAK PILL ── */
  .peak-pill {
    display: inline-block;
    background: #e8f5ec;
    border: 1px solid #b8ddc4;
    border-radius: 20px;
    padding: 5px 14px;
    font-size: 12px;
    color: #1a7a3c;
    font-weight: 600;
    margin-top: 10px;
  }

  /* ── TABLE ── */
  table { width: 100%; border-collapse: collapse; font-size: 12.5px; margin-bottom: 6px; }
  thead tr { background: #1a7a3c; }
  th {
    color: #fff;
    text-align: left;
    padding: 9px 12px;
    font-size: 10.5px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  th.r { text-align: right; }
  td { padding: 9px 12px; border-bottom: 1px solid #e8f0eb; color: #333; }
  td.num { text-align: right; font-weight: 600; }
  td.c-green { color: #1a7a3c; }
  td.c-orange { color: #e08c00; }
  td.empty { text-align: center; color: #aaa; font-style: italic; padding: 20px; }
  tr.even td { background: #f5faf6; }

  /* ── 2 COL ── */
  .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }

  /* ── FOOTER ── */
  .footer {
    margin-top: 32px;
    padding: 16px 36px;
    background: #1a7a3c;
    text-align: center;
    font-size: 11px;
    color: rgba(255,255,255,0.6);
  }
  .footer strong { color: #fff; }
</style>
</head>
<body>

<!-- HEADER -->
<div class="header">
  <div class="header-left">
    ${logoSvg}
    <div>
      <div class="brand-name">NATURALS</div>
      <div class="brand-sub">Unisex Hair &amp; Style</div>
    </div>
  </div>
  <div class="header-right">
    <div class="report-title">Daily Business Report</div>
    <div class="report-date">${escHtml(dateFormatted)}</div>
    <div class="report-gen">Generated: ${escHtml(generatedAt)} IST</div>
  </div>
</div>

<!-- BODY -->
<div class="body">

  <!-- Booking Summary -->
  <div class="sec-title">Booking Summary</div>
  <div class="kpi-grid">
    <div class="kpi">
      <div class="kpi-label">Total Bookings</div>
      <div class="kpi-value">${total}</div>
      <div class="kpi-sub">All channels</div>
    </div>
    <div class="kpi">
      <div class="kpi-label">Completed</div>
      <div class="kpi-value">${completed}</div>
      <div class="kpi-sub">Services done</div>
    </div>
    <div class="kpi amber">
      <div class="kpi-label">Pending</div>
      <div class="kpi-value">${pending}</div>
      <div class="kpi-sub">Awaiting</div>
    </div>
    <div class="kpi red">
      <div class="kpi-label">Cancelled</div>
      <div class="kpi-value">${cancelled}</div>
      <div class="kpi-sub">Today</div>
    </div>
    <div class="kpi red">
      <div class="kpi-label">No Show</div>
      <div class="kpi-value">${noShow}</div>
      <div class="kpi-sub">Absent</div>
    </div>
    <div class="kpi blue">
      <div class="kpi-label">Walk-ins</div>
      <div class="kpi-value">${walkIn}</div>
      <div class="kpi-sub">Direct visits</div>
    </div>
    <div class="kpi blue">
      <div class="kpi-label">Online (WA)</div>
      <div class="kpi-value">${online}</div>
      <div class="kpi-sub">WhatsApp</div>
    </div>
    <div class="kpi">
      <div class="kpi-label">Completion</div>
      <div class="kpi-value">${completionRate}%</div>
      <div class="kpi-sub">Rate</div>
    </div>
  </div>
  ${peakHour !== "—" ? `<div class="peak-pill">🕐 Peak Hour: ${escHtml(peakHour)}${peakCount > 0 ? ` · ${peakCount} bookings` : ""}</div>` : ""}

  <!-- Service Summary -->
  <div class="sec-title">Service Summary</div>
  <table>
    <thead><tr>
      <th>Service</th>
      <th class="r">Total</th>
      <th class="r">Completed</th>
      <th class="r">Pending</th>
    </tr></thead>
    <tbody>${serviceRows}</tbody>
  </table>

  <!-- Staff + Salons -->
  <div class="two-col">
    <div>
      <div class="sec-title">Staff Performance</div>
      <table>
        <thead><tr><th>Stylist</th><th class="r">Served</th><th class="r">Done</th></tr></thead>
        <tbody>${staffRows}</tbody>
      </table>
    </div>
    <div>
      <div class="sec-title">Top Salons Today</div>
      <table>
        <thead><tr><th>Salon</th><th class="r">Bookings</th></tr></thead>
        <tbody>${salonRows}</tbody>
      </table>
    </div>
  </div>

</div>

<!-- FOOTER -->
<div class="footer">
  <strong>Naturals Salon Management System</strong> &nbsp;·&nbsp;
  Confidential — Internal Use Only &nbsp;·&nbsp;
  ${escHtml(generatedAt)} IST
</div>

</body>
</html>`;
}

function escHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function buildReportBuffer(stats) {
  const html = buildDailyReportHtml(stats);
  return Buffer.from(html, "utf8");
}
