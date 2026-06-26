// src/reportGenerator.js
// Naturals Salon — Daily PDF Report (clean · only essential content)

export function buildDailyReportHtml(stats) {
  const {
    date,
    total,
    completed,
    pending,
    cancelled,
    noShow,
    walkIn,
    online,
    completionRate,
    peakHour,
    peakCount,
    serviceBreakdown,
    staffBreakdown,
    topSalons
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

  const serviceRows = (serviceBreakdown || []).slice(0, 8).map(s => `
    <tr>
      <td>${escHtml(s.name)}</td>
      <td class="num">${s.total}</td>
      <td class="num">${s.completed}</td>
      <td class="num">${s.pending}</td>
    </tr>`).join("") || `<tr><td colspan="4" class="empty">No service data for today</td></tr>`;

  const staffRows = (staffBreakdown || []).slice(0, 8).map(s => `
    <tr>
      <td>${escHtml(s.name)}</td>
      <td class="num">${s.served}</td>
      <td class="num">${s.completed}</td>
    </tr>`).join("") || `<tr><td colspan="3" class="empty">No staff data for today</td></tr>`;

  const salonRows = (topSalons || []).slice(0, 10).map(s => `
    <tr>
      <td>${escHtml(s.name)}</td>
      <td class="num">${s.count}</td>
    </tr>`).join("") || `<tr><td colspan="2" class="empty">No salon data for today</td></tr>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Naturals Salon — Daily Report — ${escHtml(date)}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: 'Inter', -apple-system, Arial, sans-serif;
    color: #1a1a1a;
    background: #fff;
    padding: 32px;
    font-size: 13px;
    line-height: 1.5;
  }
  .header {
    border-bottom: 3px solid #0a7d3b;
    padding-bottom: 16px;
    margin-bottom: 24px;
  }
  .brand { font-size: 24px; font-weight: 700; color: #0a7d3b; letter-spacing: 0.5px; }
  .subtitle { font-size: 13px; color: #555; margin-top: 4px; }
  .meta { font-size: 12px; color: #777; margin-top: 8px; }
  h2 {
    font-size: 15px;
    color: #0a7d3b;
    text-transform: uppercase;
    letter-spacing: 1px;
    margin: 24px 0 12px;
    padding-bottom: 6px;
    border-bottom: 1px solid #e0e0e0;
  }
  .kpi-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 10px;
    margin-bottom: 8px;
  }
  .kpi {
    background: #f7f9f7;
    border: 1px solid #e6ece6;
    border-left: 4px solid #0a7d3b;
    padding: 12px;
    border-radius: 4px;
  }
  .kpi .label { font-size: 11px; color: #666; text-transform: uppercase; letter-spacing: 0.5px; }
  .kpi .value { font-size: 22px; font-weight: 700; color: #1a1a1a; margin-top: 4px; }
  table {
    width: 100%;
    border-collapse: collapse;
    margin-bottom: 12px;
    font-size: 12px;
  }
  th {
    background: #0a7d3b;
    color: #fff;
    text-align: left;
    padding: 8px 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.4px;
    font-size: 11px;
  }
  td {
    padding: 8px 10px;
    border-bottom: 1px solid #eee;
  }
  td.num { text-align: right; font-weight: 600; }
  td.empty { text-align: center; color: #999; font-style: italic; padding: 16px; }
  tr:nth-child(even) td { background: #fafafa; }
  .footer {
    margin-top: 32px;
    padding-top: 16px;
    border-top: 1px solid #e0e0e0;
    text-align: center;
    font-size: 11px;
    color: #999;
  }
</style>
</head>
<body>

  <div class="header">
    <div class="brand">NATURALS SALON</div>
    <div class="subtitle">Daily Business Report</div>
    <div class="meta">${escHtml(dateFormatted)} &middot; Generated: ${escHtml(generatedAt)} IST</div>
  </div>

  <h2>Booking Summary</h2>
  <div class="kpi-grid">
    <div class="kpi"><div class="label">Total Bookings</div><div class="value">${total}</div></div>
    <div class="kpi"><div class="label">Completed</div><div class="value">${completed}</div></div>
    <div class="kpi"><div class="label">Pending</div><div class="value">${pending}</div></div>
    <div class="kpi"><div class="label">Cancelled</div><div class="value">${cancelled}</div></div>
    <div class="kpi"><div class="label">No Show</div><div class="value">${noShow}</div></div>
    <div class="kpi"><div class="label">Walk-ins</div><div class="value">${walkIn}</div></div>
    <div class="kpi"><div class="label">Online (WA)</div><div class="value">${online}</div></div>
    <div class="kpi"><div class="label">Completion %</div><div class="value">${completionRate}%</div></div>
  </div>
  <div class="meta" style="margin-top:8px;">
    Peak Hour: <strong>${escHtml(peakHour)}</strong>${peakCount > 0 ? ` (${peakCount} bookings)` : ""}
  </div>

  <h2>Service Summary</h2>
  <table>
    <thead><tr><th>Service</th><th style="text-align:right">Total</th><th style="text-align:right">Completed</th><th style="text-align:right">Pending</th></tr></thead>
    <tbody>${serviceRows}</tbody>
  </table>

  <h2>Staff Performance</h2>
  <table>
    <thead><tr><th>Stylist</th><th style="text-align:right">Served</th><th style="text-align:right">Completed</th></tr></thead>
    <tbody>${staffRows}</tbody>
  </table>

  <h2>Nearby / Top Salons Today</h2>
  <table>
    <thead><tr><th>Salon</th><th style="text-align:right">Bookings</th></tr></thead>
    <tbody>${salonRows}</tbody>
  </table>

  <div class="footer">
    Naturals Salon Management System &middot; Confidential — Internal Use Only<br>
    ${escHtml(generatedAt)} IST &middot; ${escHtml(date)}
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