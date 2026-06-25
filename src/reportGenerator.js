// src/reportGenerator.js
// Naturals Salon — Daily Business Report Generator
// Builds a premium HTML report from daily stats and returns it as a Buffer

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
    pendingRate,
    cancelledRate,
    noShowRate,
    peakHour,
    peakCount,
    hourlyMap,
    serviceBreakdown,
    staffBreakdown,
    topSalons
  } = stats;

  // Format date nicely
  const dateObj = new Date(date + "T00:00:00");
  const dateFormatted = dateObj.toLocaleDateString("en-IN", {
    weekday: "long", day: "numeric", month: "long", year: "numeric"
  });
  const generatedAt = new Date().toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: true
  });

  // Hourly chart bars
  const hours = Array.from({ length: 12 }, (_, i) => i + 9); // 9AM–8PM
  const maxHourly = Math.max(1, ...hours.map(h => hourlyMap[h] || 0));
  const hourBars = hours.map(h => {
    const count = hourlyMap[h] || 0;
    const pct = Math.round((count / maxHourly) * 100);
    const label = h < 12 ? `${h}AM` : h === 12 ? "12PM" : `${h - 12}PM`;
    const isPeak = count === maxHourly && count > 0;
    return `
      <div class="hb-wrap">
        <div class="hb-count">${count > 0 ? count : ""}</div>
        <div class="hb ${isPeak ? "hb-peak" : count > 0 ? "hb-active" : ""}" style="height:${Math.max(pct, 4)}%"></div>
        <div class="hb-label">${label}</div>
      </div>`;
  }).join("");

  // Service rows
  const serviceRows = serviceBreakdown.slice(0, 8).map(s => `
    <tr>
      <td class="td-name">${escHtml(s.name)}</td>
      <td class="td-center">${s.total}</td>
      <td class="td-center"><span class="badge b-green">${s.completed}</span></td>
      <td class="td-center"><span class="badge b-gold">${s.pending}</span></td>
    </tr>`).join("") || `<tr><td colspan="4" class="td-empty">No service data for today</td></tr>`;

  // Staff rows (anonymous — stylist names only, no mobile)
  const staffRows = staffBreakdown.slice(0, 8).map((s, i) => `
    <tr>
      <td class="td-name">💇 ${escHtml(s.name)}</td>
      <td class="td-center">${s.served}</td>
      <td class="td-center"><span class="badge b-green">${s.completed}</span></td>
    </tr>`).join("") || `<tr><td colspan="3" class="td-empty">No staff data for today</td></tr>`;

  // Top salon rows
  const salonRows = topSalons.map(s => `
    <tr>
      <td class="td-name">📍 ${escHtml(s.name)}</td>
      <td class="td-center">${s.count}</td>
    </tr>`).join("") || `<tr><td colspan="2" class="td-empty">No data</td></tr>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Naturals Salon — Daily Business Report — ${date}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Segoe UI',Arial,sans-serif;background:#f4f7f5;color:#1a1a1a;-webkit-print-color-adjust:exact;print-color-adjust:exact}
@media print{body{background:#fff}.no-print{display:none!important}}

/* ── PAGE ── */
.page{max-width:860px;margin:0 auto;background:#fff;box-shadow:0 4px 32px rgba(0,0,0,.12)}

/* ── HEADER ── */
.hdr{background:linear-gradient(135deg,#1B6B3A 0%,#0f4023 100%);padding:32px 36px 24px;position:relative;overflow:hidden}
.hdr::before{content:'';position:absolute;top:-30px;right:-30px;width:160px;height:160px;background:rgba(184,134,11,.18);border-radius:50%}
.hdr-top{display:flex;align-items:center;justify-content:space-between;margin-bottom:16px}
.logo-box{display:flex;align-items:center;gap:14px}
.logo-sq{width:50px;height:50px;background:#D4A017;border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:24px;font-weight:900;color:#fff;letter-spacing:-1px;flex-shrink:0}
.logo-txt h1{font-size:22px;font-weight:700;color:#fff;letter-spacing:.3px}
.logo-txt p{font-size:11px;color:rgba(255,255,255,.6);letter-spacing:1.5px;text-transform:uppercase;margin-top:2px}
.hdr-meta{text-align:right}
.hdr-meta .lbl{font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:#D4A017;margin-bottom:4px}
.hdr-meta .dt{font-size:17px;font-weight:700;color:#fff}
.hdr-meta .gen{font-size:10px;color:rgba(255,255,255,.5);margin-top:3px}
.hdr-hr{border:none;border-top:1px solid rgba(255,255,255,.15);margin-bottom:12px}
.hdr-sub{font-size:11px;color:rgba(255,255,255,.5);letter-spacing:.4px}
.hdr-sub span{color:#D4A017;font-weight:600}

/* ── BODY ── */
.body{padding:28px 36px 36px}

/* ── SECTION ── */
.sec{margin-bottom:28px}
.sec-hdr{display:flex;align-items:center;gap:10px;margin-bottom:14px;padding-bottom:8px;border-bottom:2px solid #eaf4ee}
.sec-dot{width:9px;height:9px;background:#D4A017;border-radius:50%;flex-shrink:0}
.sec-title{font-size:15px;font-weight:700;color:#1a1a1a;letter-spacing:.2px}

/* ── KPI ── */
.kpi-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:28px}
.kpi{background:#f8faf9;border:1px solid #e5e5e5;border-radius:10px;padding:16px 14px;border-left:4px solid #1B6B3A}
.kpi.gold{border-left-color:#D4A017}
.kpi.red{border-left-color:#c0392b}
.kpi.blue{border-left-color:#2471a3}
.kpi.purple{border-left-color:#7d3c98}
.kpi-lbl{font-size:9px;letter-spacing:1px;text-transform:uppercase;color:#7a7a7a;margin-bottom:6px;font-weight:600}
.kpi-val{font-size:30px;font-weight:800;color:#1B6B3A;line-height:1}
.kpi.gold .kpi-val{color:#D4A017}
.kpi.red .kpi-val{color:#c0392b}
.kpi.blue .kpi-val{color:#2471a3}
.kpi.purple .kpi-val{color:#7d3c98}
.kpi-sub{font-size:10px;color:#7a7a7a;margin-top:5px}

/* ── PERF CARDS ── */
.perf-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:20px}
.perf{background:#eaf4ee;border:1px solid rgba(27,107,58,.14);border-radius:10px;padding:12px 14px}
.perf-lbl{font-size:9px;letter-spacing:.8px;text-transform:uppercase;color:#1B6B3A;margin-bottom:5px;font-weight:700}
.perf-val{font-size:18px;font-weight:800;color:#1a1a1a}
.perf-sub{font-size:10px;color:#7a7a7a;margin-top:2px}

/* ── HOUR CHART ── */
.hour-chart{display:flex;align-items:flex-end;gap:5px;height:80px;padding:0 2px;margin-top:4px}
.hb-wrap{flex:1;display:flex;flex-direction:column;align-items:center;gap:3px;height:100%;justify-content:flex-end}
.hb-count{font-size:8px;color:#4a4a4a;font-weight:600;min-height:11px}
.hb{width:100%;border-radius:3px 3px 0 0;min-height:4px;background:#dde8e2;transition:background .2s}
.hb-active{background:#52a975}
.hb-peak{background:#1B6B3A}
.hb-label{font-size:7.5px;color:#7a7a7a;text-align:center;white-space:nowrap}

/* ── TABLE ── */
table{width:100%;border-collapse:collapse;font-size:12.5px}
thead tr{background:#1B6B3A;color:#fff}
thead th{padding:10px 12px;text-align:left;font-size:10px;letter-spacing:.5px;text-transform:uppercase;font-weight:700}
thead th:last-child,th.tc{text-align:center}
tbody tr{border-bottom:1px solid #f0f0f0}
tbody tr:hover{background:#f8faf9}
tbody tr:last-child{border-bottom:none}
td{padding:10px 12px;color:#4a4a4a}
.td-name{font-weight:600;color:#1a1a1a}
.td-center{text-align:center}
.td-empty{text-align:center;color:#aaa;font-style:italic;padding:16px}
.badge{display:inline-block;padding:2px 8px;border-radius:20px;font-size:11px;font-weight:700}
.b-green{background:#eaf4ee;color:#1B6B3A}
.b-gold{background:#fdf8ec;color:#B8860B}

/* ── STATUS BARS ── */
.status-wrap{background:#f8faf9;border:1px solid #e5e5e5;border-radius:10px;padding:18px;display:grid;grid-template-columns:1fr 1fr;gap:14px}
.si-hdr{display:flex;justify-content:space-between;margin-bottom:5px}
.si-lbl{font-size:11px;font-weight:600;color:#4a4a4a}
.si-pct{font-size:12px;font-weight:800}
.bar-track{height:7px;background:#e5e5e5;border-radius:4px;overflow:hidden}
.bar-fill{height:100%;border-radius:4px}
.bc{background:#1B6B3A}.bp{background:#D4A017}.bx{background:#c0392b}.bn{background:#7f8c8d}

/* ── 2-COL ── */
.two-col{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:28px}

/* ── FOOTER ── */
.ftr{background:#1a1a1a;padding:16px 36px;display:flex;justify-content:space-between;align-items:center}
.ftr-l{font-size:10px;color:rgba(255,255,255,.4);letter-spacing:.4px}
.ftr-l strong{color:#D4A017}
.ftr-r{font-size:10px;color:rgba(255,255,255,.3)}

/* ── RESPONSIVE ── */
@media(max-width:600px){
  .body{padding:16px}
  .hdr{padding:20px 16px 16px}
  .kpi-grid{grid-template-columns:repeat(2,1fr)}
  .perf-grid{grid-template-columns:repeat(2,1fr)}
  .two-col{grid-template-columns:1fr}
  .status-wrap{grid-template-columns:1fr}
  .hdr-top{flex-direction:column;align-items:flex-start;gap:10px}
  .hdr-meta{text-align:left}
  .ftr{flex-direction:column;gap:6px;text-align:center}
}
</style>
</head>
<body>
<div class="page">

<!-- HEADER -->
<div class="hdr">
  <div class="hdr-top">
    <div class="logo-box">
      <div class="logo-sq">N</div>
      <div class="logo-txt">
        <h1>Naturals Salon</h1>
        <p>Unisex Hair &amp; Style</p>
      </div>
    </div>
    <div class="hdr-meta">
      <div class="lbl">Daily Business Report</div>
      <div class="dt">${escHtml(dateFormatted)}</div>
      <div class="gen">Generated: ${escHtml(generatedAt)} IST</div>
    </div>
  </div>
  <hr class="hdr-hr">
  <div class="hdr-sub">Automated Business Summary &nbsp;·&nbsp; <span>Confidential — Internal Use Only</span> &nbsp;·&nbsp; No customer personal data included</div>
</div>

<!-- BODY -->
<div class="body">

<!-- KPI Grid -->
<div class="kpi-grid">
  <div class="kpi">
    <div class="kpi-lbl">Total Bookings</div>
    <div class="kpi-val">${total}</div>
    <div class="kpi-sub">All channels today</div>
  </div>
  <div class="kpi">
    <div class="kpi-lbl">Completed</div>
    <div class="kpi-val">${completed}</div>
    <div class="kpi-sub">Services delivered</div>
  </div>
  <div class="kpi gold">
    <div class="kpi-lbl">Pending</div>
    <div class="kpi-val">${pending}</div>
    <div class="kpi-sub">Awaiting confirmation</div>
  </div>
  <div class="kpi red">
    <div class="kpi-lbl">Cancelled / Rejected</div>
    <div class="kpi-val">${cancelled}</div>
    <div class="kpi-sub">Today's cancellations</div>
  </div>
  <div class="kpi blue">
    <div class="kpi-lbl">No Show</div>
    <div class="kpi-val">${noShow}</div>
    <div class="kpi-sub">Absent without notice</div>
  </div>
  <div class="kpi purple">
    <div class="kpi-lbl">Walk-ins</div>
    <div class="kpi-val">${walkIn}</div>
    <div class="kpi-sub">Without prior booking</div>
  </div>
</div>

<!-- Business Performance -->
<div class="sec">
  <div class="sec-hdr"><div class="sec-dot"></div><div class="sec-title">Business Performance</div></div>
  <div class="perf-grid">
    <div class="perf">
      <div class="perf-lbl">Online Bookings</div>
      <div class="perf-val">${online}</div>
      <div class="perf-sub">via WhatsApp Bot</div>
    </div>
    <div class="perf">
      <div class="perf-lbl">Walk-in Customers</div>
      <div class="perf-val">${walkIn}</div>
      <div class="perf-sub">Direct visits</div>
    </div>
    <div class="perf">
      <div class="perf-lbl">Peak Booking Hour</div>
      <div class="perf-val" style="font-size:14px">${escHtml(peakHour)}</div>
      <div class="perf-sub">Highest footfall — ${peakCount} bookings</div>
    </div>
    <div class="perf">
      <div class="perf-lbl">Completion Rate</div>
      <div class="perf-val">${completionRate}%</div>
      <div class="perf-sub">Of total bookings</div>
    </div>
    <div class="perf">
      <div class="perf-lbl">Pending Rate</div>
      <div class="perf-val">${pendingRate}%</div>
      <div class="perf-sub">Needs follow-up</div>
    </div>
    <div class="perf">
      <div class="perf-lbl">Cancellation Rate</div>
      <div class="perf-val">${cancelledRate}%</div>
      <div class="perf-sub">Today's rejections</div>
    </div>
  </div>
</div>

<!-- Hourly Chart -->
<div class="sec">
  <div class="sec-hdr"><div class="sec-dot"></div><div class="sec-title">Hourly Booking Distribution</div></div>
  <div class="hour-chart">${hourBars}</div>
</div>

<!-- Service Summary -->
<div class="sec">
  <div class="sec-hdr"><div class="sec-dot"></div><div class="sec-title">Service Summary</div></div>
  <table>
    <thead>
      <tr>
        <th>Service</th>
        <th class="tc">Total</th>
        <th class="tc">Completed</th>
        <th class="tc">Pending</th>
      </tr>
    </thead>
    <tbody>${serviceRows}</tbody>
  </table>
</div>

<!-- Staff + Status -->
<div class="two-col">
  <!-- Staff -->
  <div class="sec">
    <div class="sec-hdr"><div class="sec-dot"></div><div class="sec-title">Staff Performance</div></div>
    <table>
      <thead>
        <tr>
          <th>Stylist</th>
          <th class="tc">Served</th>
          <th class="tc">Done</th>
        </tr>
      </thead>
      <tbody>${staffRows}</tbody>
    </table>
  </div>

  <!-- Status Breakdown -->
  <div class="sec">
    <div class="sec-hdr"><div class="sec-dot"></div><div class="sec-title">Status Breakdown</div></div>
    <div class="status-wrap">
      <div>
        <div class="si-hdr"><span class="si-lbl">✅ Completed</span><span class="si-pct" style="color:#1B6B3A">${completionRate}%</span></div>
        <div class="bar-track"><div class="bar-fill bc" style="width:${completionRate}%"></div></div>
      </div>
      <div>
        <div class="si-hdr"><span class="si-lbl">⏳ Pending</span><span class="si-pct" style="color:#D4A017">${pendingRate}%</span></div>
        <div class="bar-track"><div class="bar-fill bp" style="width:${pendingRate}%"></div></div>
      </div>
      <div>
        <div class="si-hdr"><span class="si-lbl">❌ Cancelled</span><span class="si-pct" style="color:#c0392b">${cancelledRate}%</span></div>
        <div class="bar-track"><div class="bar-fill bx" style="width:${cancelledRate}%"></div></div>
      </div>
      <div>
        <div class="si-hdr"><span class="si-lbl">👻 No Show</span><span class="si-pct" style="color:#7f8c8d">${noShowRate}%</span></div>
        <div class="bar-track"><div class="bar-fill bn" style="width:${noShowRate}%"></div></div>
      </div>
    </div>
    <div style="margin-top:10px">
      <div class="sec-hdr" style="margin-top:14px"><div class="sec-dot"></div><div class="sec-title" style="font-size:13px">Top Salons Today</div></div>
      <table>
        <thead><tr><th>Salon</th><th class="tc">Bookings</th></tr></thead>
        <tbody>${salonRows}</tbody>
      </table>
    </div>
  </div>
</div>

</div><!-- /body -->

<!-- FOOTER -->
<div class="ftr">
  <div class="ftr-l">Generated automatically by &nbsp;<strong>Naturals Salon Management System</strong></div>
  <div class="ftr-r">${escHtml(generatedAt)} IST &nbsp;·&nbsp; ${escHtml(date)}</div>
</div>

</div><!-- /page -->
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