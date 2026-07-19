import { URL } from "node:url";
import { buildAnalyticsSummary, buildTimeSeries } from "./metrics.mjs";
import {
  createEmailVerificationCodeInStorage,
  createUserInStorage,
  getStorageBackendInfo,
  loadDb,
  loginUserInStorage,
  recordAnalyticsEventInStorage,
  verifyEmailCodeInStorage,
} from "./store.mjs";
import { createFixedWindowRateLimiter, normalizeIpAddress } from "./security.mjs";

const DEFAULT_BODY_LIMIT_BYTES = 64 * 1024;
const EXTENSION_ORIGIN_PREFIX = "chrome-extension://";

class HttpError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.name = "HttpError";
    this.statusCode = statusCode;
  }
}

function buildCorsHeaders(req) {
  const origin = String(req.headers.origin || "").trim();
  if (!origin) return {};
  if (origin.startsWith(EXTENSION_ORIGIN_PREFIX)) {
    return {
      "Access-Control-Allow-Origin": origin,
      Vary: "Origin",
    };
  }
  return {};
}

function jsonHeaders(req) {
  return {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
    Pragma: "no-cache",
    Expires: "0",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    ...buildCorsHeaders(req),
  };
}

function htmlHeaders(req) {
  return {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
    Pragma: "no-cache",
    Expires: "0",
    ...buildCorsHeaders(req),
  };
}

function sendJson(req, res, statusCode, payload) {
  res.writeHead(statusCode, jsonHeaders(req));
  res.end(JSON.stringify(payload));
}

function sendHtml(req, res, statusCode, html) {
  res.writeHead(statusCode, htmlHeaders(req));
  res.end(html);
}

function renderAdminTokenGateHtml(publicBaseUrl) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Analytics Admin Access</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: #09111f;
      --panel: rgba(11, 20, 37, 0.88);
      --line: rgba(163, 193, 255, 0.14);
      --text: #eef4ff;
      --muted: #96a8c3;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100dvh;
      display: grid;
      place-items: center;
      padding: 24px;
      font-family: "Bahnschrift", "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
      color: var(--text);
      background:
        radial-gradient(circle at top left, rgba(94, 162, 255, 0.24), transparent 26%),
        linear-gradient(180deg, #08101d 0%, var(--bg) 100%);
    }
    .panel {
      width: min(100%, 460px);
      padding: 28px;
      border: 1px solid var(--line);
      border-radius: 24px;
      background: var(--panel);
      box-shadow: 0 28px 80px rgba(0, 0, 0, 0.42);
    }
    h1 {
      margin: 0 0 12px;
      font-size: 32px;
      letter-spacing: -0.04em;
    }
    p {
      margin: 0 0 18px;
      color: var(--muted);
      line-height: 1.7;
    }
    label {
      display: block;
      margin-bottom: 8px;
      font-size: 13px;
      font-weight: 700;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: var(--muted);
    }
    input {
      width: 100%;
      padding: 14px 16px;
      border: 1px solid rgba(163, 193, 255, 0.16);
      border-radius: 16px;
      background: rgba(255, 255, 255, 0.04);
      color: var(--text);
      font: inherit;
    }
    button {
      margin-top: 14px;
      width: 100%;
      padding: 14px 16px;
      border: 0;
      border-radius: 999px;
      background: linear-gradient(180deg, #79b5ff 0%, #4e91f8 100%);
      color: #08101d;
      font: inherit;
      font-weight: 700;
      cursor: pointer;
    }
    .meta {
      margin-top: 14px;
      color: var(--muted);
      font-size: 12px;
    }
  </style>
</head>
<body>
  <form class="panel" method="GET" action="/">
    <h1>需要 Admin Token</h1>
    <p>analytics dashboard 已启用管理口令。输入 token 后将通过查询参数重新加载当前页面。</p>
    <label for="adminToken">Admin Token</label>
    <input id="adminToken" name="adminToken" type="password" autocomplete="current-password" required>
    <button type="submit">进入 Dashboard</button>
    <div class="meta">服务地址：${publicBaseUrl}</div>
  </form>
</body>
</html>`;
}

function renderDashboardHtml(summary, series, publicBaseUrl, storageInfo, tokenQuery = "") {
  const initialData = JSON.stringify({ summary, series }).replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>插件使用状态面板</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: #09111f;
      --panel: rgba(11, 20, 37, 0.82);
      --panel-strong: rgba(14, 26, 48, 0.94);
      --line: rgba(163, 193, 255, 0.14);
      --text: #eef4ff;
      --muted: #96a8c3;
      --accent: #5ea2ff;
      --accent-2: #65f0c7;
      --accent-3: #ffb05b;
      --accent-4: #d08bff;
      --success: #65f0c7;
      --shadow: 0 28px 80px rgba(0, 0, 0, 0.42);
      --radius: 22px;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100dvh;
      font-family: "Bahnschrift", "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
      color: var(--text);
      background:
        radial-gradient(circle at top left, rgba(94, 162, 255, 0.24), transparent 26%),
        radial-gradient(circle at 85% 10%, rgba(101, 240, 199, 0.15), transparent 24%),
        radial-gradient(circle at 50% 100%, rgba(208, 139, 255, 0.10), transparent 36%),
        linear-gradient(180deg, #08101d 0%, var(--bg) 100%);
    }
    .shell {
      max-width: 1360px;
      margin: 0 auto;
      padding: 28px 20px 42px;
    }
    .hero,
    .workspace {
      display: grid;
      gap: 16px;
    }
    .hero {
      grid-template-columns: 1.4fr 0.8fr;
      margin-bottom: 18px;
    }
    .workspace {
      grid-template-columns: minmax(0, 1.3fr) minmax(320px, 0.9fr);
    }
    .hero-main,
    .hero-side,
    .metric,
    .panel {
      border: 1px solid var(--line);
      border-radius: var(--radius);
      background: var(--panel);
      backdrop-filter: blur(18px);
      box-shadow: var(--shadow);
    }
    .hero-main {
      padding: 26px 28px 24px;
      background:
        linear-gradient(135deg, rgba(94, 162, 255, 0.14), rgba(11, 20, 37, 0) 38%),
        linear-gradient(180deg, rgba(255, 255, 255, 0.02), rgba(255, 255, 255, 0) 32%),
        var(--panel-strong);
    }
    .hero-side,
    .panel {
      padding: 22px;
    }
    .hero-side {
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      gap: 18px;
    }
    .eyebrow,
    .metric-label,
    .side-label,
    .hero-note-label,
    .table thead th {
      color: var(--muted);
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.14em;
      text-transform: uppercase;
    }
    .eyebrow {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 14px;
      color: var(--accent-2);
      letter-spacing: 0.16em;
    }
    .eyebrow::before {
      content: "";
      width: 26px;
      height: 1px;
      background: currentColor;
    }
    h1 {
      margin: 0 0 10px;
      max-width: 10ch;
      font-size: clamp(42px, 7vw, 64px);
      line-height: 0.95;
      letter-spacing: -0.05em;
    }
    .lead,
    .hero-note-sub,
    .panel-copy,
    .metric-hint,
    .meta,
    .side-copy {
      color: var(--muted);
      line-height: 1.6;
    }
    .lead,
    .side-copy {
      font-size: 15px;
    }
    .hero-footer,
    .metric-grid {
      display: grid;
      gap: 14px;
    }
    .hero-footer {
      grid-template-columns: repeat(3, minmax(0, 1fr));
      margin-top: 22px;
    }
    .hero-note {
      padding: 14px;
      border: 1px solid rgba(163, 193, 255, 0.10);
      border-radius: 16px;
      background: rgba(255, 255, 255, 0.02);
    }
    .hero-note-value,
    .side-value,
    .metric-value {
      font-weight: 700;
      letter-spacing: -0.04em;
    }
    .hero-note-value {
      font-size: 20px;
    }
    .side-value {
      font-size: 28px;
    }
    .metric-grid {
      grid-template-columns: repeat(5, minmax(0, 1fr));
      margin-bottom: 18px;
    }
    .metric {
      padding: 18px 18px 16px;
    }
    .metric-value {
      font-size: clamp(28px, 4vw, 38px);
      line-height: 0.95;
      margin: 10px 0;
    }
    .panel {
      display: flex;
      flex-direction: column;
      min-height: 520px;
    }
    .panel-head {
      display: flex;
      justify-content: space-between;
      align-items: end;
      gap: 16px;
      margin-bottom: 18px;
    }
    .panel-title {
      margin: 0;
      font-size: 22px;
      letter-spacing: -0.03em;
    }
    .chart-shell,
    .table-card {
      flex: 1;
      padding: 18px;
      border: 1px solid rgba(163, 193, 255, 0.08);
      border-radius: 18px;
      background:
        linear-gradient(180deg, rgba(94, 162, 255, 0.05), rgba(255, 255, 255, 0.01)),
        rgba(255, 255, 255, 0.01);
    }
    .table-card {
      display: flex;
      flex-direction: column;
      min-height: 0;
    }
    .table-shell {
      flex: 1;
      min-height: 0;
      overflow: auto;
      padding-right: 4px;
    }
    .chart {
      position: relative;
      min-height: 280px;
    }
    .chart-tooltip {
      position: absolute;
      left: 0;
      top: 0;
      z-index: 2;
      min-width: 120px;
      padding: 10px 12px;
      border: 1px solid rgba(163, 193, 255, 0.18);
      border-radius: 14px;
      background: rgba(7, 14, 28, 0.96);
      box-shadow: 0 18px 40px rgba(0, 0, 0, 0.34);
      pointer-events: none;
      opacity: 0;
      transition: opacity 120ms ease;
    }
    .chart-tooltip.is-visible {
      opacity: 1;
    }
    .chart-tooltip-date {
      color: var(--muted);
      font-size: 11px;
      margin-bottom: 6px;
    }
    .chart-tooltip-row {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 12px;
      white-space: nowrap;
    }
    .chart-tooltip-dot,
    .legend-swatch {
      width: 10px;
      height: 10px;
      border-radius: 999px;
      flex: 0 0 auto;
    }
    .legend {
      display: flex;
      gap: 16px;
      flex-wrap: wrap;
      margin-top: 12px;
      color: var(--muted);
      font-size: 12px;
    }
    .legend-item {
      display: inline-flex;
      align-items: center;
      gap: 8px;
    }
    .table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
    }
    .table thead th {
      padding: 0 0 12px;
      border-bottom: 1px solid var(--line);
      text-align: left;
    }
    .table tbody td {
      padding: 14px 0;
      border-bottom: 1px solid rgba(163, 193, 255, 0.08);
      color: #d7e4f9;
    }
    .pager {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding-top: 14px;
      margin-top: 14px;
      border-top: 1px solid rgba(163, 193, 255, 0.08);
    }
    .pager-actions {
      display: flex;
      gap: 8px;
    }
    .actions {
      display: flex;
      gap: 10px;
      align-items: center;
      flex-wrap: wrap;
    }
    button {
      appearance: none;
      border-radius: 999px;
      font: inherit;
      font-weight: 700;
      cursor: pointer;
    }
    .actions button {
      border: 1px solid rgba(255, 255, 255, 0.08);
      background: linear-gradient(180deg, #79b5ff 0%, #4e91f8 100%);
      color: #08101d;
      padding: 12px 16px;
    }
    .pager-btn {
      border: 1px solid rgba(163, 193, 255, 0.14);
      background: rgba(255, 255, 255, 0.03);
      color: var(--text);
      padding: 9px 12px;
      font-size: 12px;
    }
    .empty {
      color: var(--muted);
      padding: 18px 0 6px;
      font-size: 14px;
    }
    .status {
      margin-top: 14px;
      color: var(--success);
      font-size: 14px;
      min-height: 20px;
    }
    @media (max-width: 1120px) {
      .hero,
      .workspace {
        grid-template-columns: 1fr;
      }
      .metric-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
      .panel {
        min-height: auto;
      }
    }
    @media (max-width: 640px) {
      .shell {
        padding: 18px 14px 28px;
      }
      h1 {
        max-width: none;
        font-size: 38px;
      }
      .hero-footer,
      .metric-grid {
        grid-template-columns: 1fr;
      }
      .panel-head,
      .pager {
        align-items: start;
        flex-direction: column;
      }
    }
  </style>
</head>
<body>
  <div class="shell">
    <div class="hero">
      <section class="hero-main">
        <div class="eyebrow">本地运营视图</div>
        <h1>一眼看清插件使用状态</h1>
        <div class="lead">直接在本地 analytics server 里查看安装、活跃设备、激活和注册情况。</div>
        <div class="hero-footer">
          <div class="hero-note">
            <div class="hero-note-label">观察窗口</div>
            <div class="hero-note-value">14 天</div>
            <div class="hero-note-sub">滚动趋势加上每日明细。</div>
          </div>
          <div class="hero-note">
            <div class="hero-note-label">数据来源</div>
            <div class="hero-note-value">${storageInfo.label}</div>
            <div class="hero-note-sub">${storageInfo.detail}</div>
          </div>
          <div class="hero-note">
            <div class="hero-note-label">视图模式</div>
            <div class="hero-note-value">监控</div>
            <div class="hero-note-sub">只读的运营监控面板。</div>
          </div>
        </div>
      </section>
      <aside class="hero-side">
        <div>
          <div class="side-label">当前快照</div>
          <div class="side-value" id="snapshotDevices">0 台设备</div>
          <div class="side-copy" id="snapshotCopy"></div>
        </div>
        <div class="actions">
          <button id="refreshBtn" type="button">刷新面板</button>
          <div class="meta">${publicBaseUrl}</div>
        </div>
      </aside>
    </div>
    <div class="metric-grid" id="metricGrid"></div>
    <div class="workspace">
      <section class="panel">
        <div class="panel-head">
          <div>
            <h2 class="panel-title">14 天活跃趋势</h2>
            <div class="panel-copy">把使用、安装、激活、注册的日级变化放在一起。</div>
          </div>
          <div class="meta" id="generatedAt"></div>
        </div>
        <div class="chart-shell">
          <div class="chart" id="chart"></div>
          <div class="legend">
            <span class="legend-item"><span class="legend-swatch" style="background:#5ea2ff"></span>日活</span>
            <span class="legend-item"><span class="legend-swatch" style="background:#ffb05b"></span>安装</span>
            <span class="legend-item"><span class="legend-swatch" style="background:#65f0c7"></span>激活</span>
            <span class="legend-item"><span class="legend-swatch" style="background:#d08bff"></span>注册</span>
          </div>
        </div>
      </section>
      <section class="panel">
        <div class="panel-head">
          <div>
            <h2 class="panel-title">每日明细</h2>
            <div class="panel-copy">用表格对照推广、测试和导入用户的日子。</div>
          </div>
        </div>
        <div class="table-card">
          <div class="table-shell" id="tableWrap"></div>
          <div class="pager" id="tablePager"></div>
        </div>
      </section>
    </div>
    <div class="status" id="status"></div>
  </div>
  <script>
    const stateHolder = ${initialData};
    const metricGrid = document.getElementById("metricGrid");
    const chart = document.getElementById("chart");
    const tableWrap = document.getElementById("tableWrap");
    const tablePager = document.getElementById("tablePager");
    const status = document.getElementById("status");
    const generatedAt = document.getElementById("generatedAt");
    const refreshBtn = document.getElementById("refreshBtn");
    const snapshotDevices = document.getElementById("snapshotDevices");
    const snapshotCopy = document.getElementById("snapshotCopy");
    const TABLE_PAGE_SIZE = 7;
    const LEGEND = [
      { key: "dau", color: "#5ea2ff", label: "日活" },
      { key: "installs", color: "#ffb05b", label: "安装" },
      { key: "activations", color: "#65f0c7", label: "激活" },
      { key: "registrations", color: "#d08bff", label: "注册" },
    ];
    let tablePage = 0;
    let state = stateHolder;

    function formatNumber(value) {
      return new Intl.NumberFormat("en-US").format(Number(value || 0));
    }

    function metricCard(label, value, hint) {
      return '<article class="metric">' +
        '<div class="metric-label">' + label + "</div>" +
        '<div class="metric-value">' + value + "</div>" +
        '<div class="metric-hint">' + hint + "</div>" +
      "</article>";
    }

    function renderMetrics(summary) {
      metricGrid.innerHTML = [
        metricCard("今日日活", formatNumber(summary.daily.dau), "今天产生任意事件的设备数。"),
        metricCard("今日安装", formatNumber(summary.daily.installs), "今天首次被记录的新设备。"),
        metricCard("今日激活", formatNumber(summary.daily.activations), "完成关键设置或产生实际使用的设备数。"),
        metricCard("累计设备", formatNumber(summary.totals.devices), "整个数据集里去重后的所有设备。"),
        metricCard("注册用户", formatNumber(summary.totals.registeredUsers), "当前成功注册的账号数。"),
      ].join("");
    }

    function renderSnapshot(summary) {
      snapshotDevices.textContent = formatNumber(summary.totals.devices) + " 台设备";
      snapshotCopy.textContent =
        "WAU " + formatNumber(summary.rolling.wau) +
        "，MAU " + formatNumber(summary.rolling.mau) +
        "，累计事件 " + formatNumber(summary.totals.events) + "。";
      generatedAt.textContent = "生成时间 " + new Date(summary.generatedAt).toLocaleString();
    }

    function buildSeriesPoints(series, key, maxValue, width, height, padding) {
      return series.map((item, index) => {
        const x = padding + (index * (width - padding * 2) / Math.max(1, series.length - 1));
        const y = height - padding - ((item[key] || 0) / Math.max(1, maxValue)) * (height - padding * 2);
        return { x, y };
      });
    }

    function buildSmoothPath(points) {
      if (!points.length) return "";
      if (points.length === 1) return "M " + points[0].x.toFixed(1) + " " + points[0].y.toFixed(1);
      const tension = 0.18;
      let path = "M " + points[0].x.toFixed(1) + " " + points[0].y.toFixed(1);
      for (let index = 0; index < points.length - 1; index += 1) {
        const prev = points[Math.max(0, index - 1)];
        const current = points[index];
        const next = points[index + 1];
        const after = points[Math.min(points.length - 1, index + 2)];
        const cp1x = current.x + (next.x - prev.x) * tension;
        const cp1y = current.y + (next.y - prev.y) * tension;
        const cp2x = next.x - (after.x - current.x) * tension;
        const cp2y = next.y - (after.y - current.y) * tension;
        path += " C " +
          cp1x.toFixed(1) + " " + cp1y.toFixed(1) + ", " +
          cp2x.toFixed(1) + " " + cp2y.toFixed(1) + ", " +
          next.x.toFixed(1) + " " + next.y.toFixed(1);
      }
      return path;
    }

    function clamp(value, min, max) {
      return Math.min(max, Math.max(min, value));
    }

    function renderChart(series) {
      if (!series.length) {
        chart.innerHTML = '<div class="empty">暂时还没有趋势数据。</div>';
        return;
      }
      const width = 860;
      const height = 280;
      const padding = 26;
      const maxValue = Math.max(1, ...series.flatMap((item) => [item.dau, item.installs, item.activations, item.registrations]));
      const guides = Array.from({ length: 4 }, (_, index) => {
        const y = padding + index * ((height - padding * 2) / 3);
        return '<line x1="' + padding + '" y1="' + y.toFixed(1) + '" x2="' + (width - padding) + '" y2="' + y.toFixed(1) + '" stroke="rgba(163,193,255,0.08)" stroke-dasharray="4 8" />';
      }).join("");
      const lines = LEGEND.map((item) => {
        const points = buildSeriesPoints(series, item.key, maxValue, width, height, padding);
        return '<path fill="none" stroke="' + item.color + '" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" d="' + buildSmoothPath(points) + '" />';
      }).join("");
      const step = (width - padding * 2) / Math.max(1, series.length - 1);
      const hits = series.map((item, index) => {
        const x = padding + (index * (width - padding * 2) / Math.max(1, series.length - 1));
        const hitX = index === 0 ? padding - step * 0.35 : x - step * 0.5;
        const hitWidth = index === 0 || index === series.length - 1 ? step * 0.85 : step;
        return '<rect class="chart-hit" x="' + hitX.toFixed(1) + '" y="0" width="' + hitWidth.toFixed(1) + '" height="' + height + '" fill="rgba(255,255,255,0.001)" data-index="' + index + '" />';
      }).join("");
      const labels = series.map((item, index) => {
        const x = padding + (index * (width - padding * 2) / Math.max(1, series.length - 1));
        return '<text x="' + x.toFixed(1) + '" y="' + (height - 6) + '" font-size="11" fill="#7f96b8" text-anchor="middle">' + item.date.slice(5) + "</text>";
      }).join("");
      chart.innerHTML =
        '<div class="chart-tooltip" id="chartTooltip"></div>' +
        '<svg viewBox="0 0 ' + width + " " + height + '" role="img" aria-label="analytics trend chart">' +
          guides +
          '<line x1="' + padding + '" y1="' + (height - padding) + '" x2="' + (width - padding) + '" y2="' + (height - padding) + '" stroke="rgba(163,193,255,0.18)" />' +
          lines +
          hits +
          labels +
        "</svg>";
      const tooltip = document.getElementById("chartTooltip");
      chart.querySelectorAll(".chart-hit").forEach((node) => {
        node.addEventListener("mouseenter", (event) => {
          const target = event.currentTarget;
          if (!(target instanceof Element) || !tooltip) return;
          const index = Number(target.getAttribute("data-index") || "0");
          const item = series[index];
          tooltip.innerHTML =
            '<div class="chart-tooltip-date">' + item.date + "</div>" +
            LEGEND.map((legend) =>
              '<div class="chart-tooltip-row"><span class="chart-tooltip-dot" style="background:' + legend.color + '"></span><span>' + legend.label + "：" + formatNumber(item[legend.key] || 0) + "</span></div>"
            ).join("");
          tooltip.classList.add("is-visible");
        });
        node.addEventListener("mousemove", (event) => {
          if (!tooltip) return;
          const rect = chart.getBoundingClientRect();
          const tooltipWidth = tooltip.offsetWidth || 160;
          const tooltipHeight = tooltip.offsetHeight || 120;
          const left = clamp(event.clientX - rect.left + 14, 8, rect.width - tooltipWidth - 8);
          const top = clamp(event.clientY - rect.top - tooltipHeight - 14, 8, rect.height - tooltipHeight - 8);
          tooltip.style.left = left + "px";
          tooltip.style.top = top + "px";
        });
      });
      chart.addEventListener("mouseleave", () => {
        if (tooltip) tooltip.classList.remove("is-visible");
      });
    }

    function renderTable(series) {
      if (!series.length) {
        tableWrap.innerHTML = '<div class="empty">暂时还没有统计数据。</div>';
        tablePager.innerHTML = "";
        return;
      }
      const reversed = series.slice().reverse();
      const pageCount = Math.max(1, Math.ceil(reversed.length / TABLE_PAGE_SIZE));
      tablePage = Math.min(tablePage, pageCount - 1);
      const start = tablePage * TABLE_PAGE_SIZE;
      const pageItems = reversed.slice(start, start + TABLE_PAGE_SIZE);
      const rows = pageItems.map((item) =>
        "<tr><td>" + item.date + "</td><td>" + formatNumber(item.dau) + "</td><td>" + formatNumber(item.installs) + "</td><td>" + formatNumber(item.activations) + "</td><td>" + formatNumber(item.registrations) + "</td></tr>"
      ).join("");
      tableWrap.innerHTML =
        '<table class="table">' +
          "<thead><tr><th>日期</th><th>日活</th><th>安装</th><th>激活</th><th>注册</th></tr></thead>" +
          "<tbody>" + rows + "</tbody>" +
        "</table>";
      tablePager.innerHTML =
        '<div class="meta">第 ' + (tablePage + 1) + ' / ' + pageCount + ' 页，显示 ' + (start + 1) + '-' + (start + pageItems.length) + " 条记录</div>" +
        '<div class="pager-actions">' +
          '<button class="pager-btn" type="button" data-page="prev"' + (tablePage === 0 ? " disabled" : "") + ">上一页</button>" +
          '<button class="pager-btn" type="button" data-page="next"' + (tablePage >= pageCount - 1 ? " disabled" : "") + ">下一页</button>" +
        "</div>";
      const prevBtn = tablePager.querySelector('[data-page="prev"]');
      const nextBtn = tablePager.querySelector('[data-page="next"]');
      if (prevBtn) prevBtn.addEventListener("click", () => { tablePage = Math.max(0, tablePage - 1); renderTable(state.series); });
      if (nextBtn) nextBtn.addEventListener("click", () => { tablePage = Math.min(pageCount - 1, tablePage + 1); renderTable(state.series); });
    }

    function render(nextState) {
      state = nextState;
      tablePage = 0;
      renderMetrics(state.summary);
      renderSnapshot(state.summary);
      renderChart(state.series);
      renderTable(state.series);
      status.textContent = "面板已同步到 " + new Date(state.summary.generatedAt).toLocaleString();
    }

    async function refreshData() {
      refreshBtn.disabled = true;
      status.textContent = "正在刷新面板...";
      try {
        const response = await fetch("/admin/data${tokenQuery}", { cache: "no-store" });
        if (!response.ok) throw new Error("HTTP " + response.status);
        const payload = await response.json();
        render({ summary: payload.summary, series: payload.series });
      } catch (error) {
        status.textContent = "刷新失败：" + (error && error.message ? error.message : String(error));
      } finally {
        refreshBtn.disabled = false;
      }
    }

    refreshBtn.addEventListener("click", refreshData);
    render(state);
  </script>
</body>
</html>`;
}

function ensureTrustedBrowserOrigin(req) {
  const origin = String(req.headers.origin || "").trim();
  if (!origin) return;
  if (!origin.startsWith(EXTENSION_ORIGIN_PREFIX)) {
    throw new HttpError(403, "browser origin is not allowed");
  }
}

async function readJsonBody(req, maxBytes = DEFAULT_BODY_LIMIT_BYTES) {
  return new Promise((resolve, reject) => {
    let raw = "";
    let aborted = false;

    req.on("data", (chunk) => {
      if (aborted) return;
      raw += chunk;
      if (Buffer.byteLength(raw, "utf8") > maxBytes) {
        aborted = true;
        reject(new HttpError(413, `request body exceeds ${maxBytes} bytes`));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (aborted) return;
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new HttpError(400, "invalid json body"));
      }
    });
    req.on("error", (error) => {
      if (aborted && error?.code === "ECONNRESET") return;
      reject(error);
    });
  });
}

function getBearerToken(req) {
  const authHeader = req.headers.authorization || "";
  const match = /^Bearer\s+(.+)$/i.exec(authHeader);
  return match?.[1] || "";
}

function getAdminToken(req, url) {
  const bearerToken = getBearerToken(req);
  if (bearerToken) return bearerToken;
  return String(url.searchParams.get("adminToken") || "").trim();
}

function requireAdminToken(req, url, expectedToken) {
  const normalized = String(expectedToken || "").trim();
  if (!normalized) return false;
  if (getAdminToken(req, url) !== normalized) {
    throw new HttpError(401, "admin authorization required");
  }
  return true;
}

function enforceRateLimit(rateLimiter, key, limit, windowMs) {
  const result = rateLimiter.consume(key, limit, windowMs);
  if (!result.allowed) {
    const retryAfter = Math.max(1, Math.ceil((result.resetAt - Date.now()) / 1000));
    throw new HttpError(429, `rate limit exceeded; retry after ${retryAfter}s`);
  }
}

export function createAnalyticsHandler(options = {}) {
  const {
    adminToken = process.env.ANALYTICS_ADMIN_TOKEN,
    createEmailVerificationCodeImpl = createEmailVerificationCodeInStorage,
    createUserImpl = createUserInStorage,
    isMailerConfigured,
    loadDbImpl = loadDb,
    loginUserImpl = loginUserInStorage,
    publicBaseUrl = process.env.PUBLIC_BASE_URL || "http://127.0.0.1:8787",
    rateLimiter = createFixedWindowRateLimiter(),
    recordAnalyticsEventImpl = recordAnalyticsEventInStorage,
    sendVerificationCodeEmail,
    verifyEmailCodeImpl = verifyEmailCodeInStorage,
  } = options;

  if (typeof isMailerConfigured !== "function") {
    throw new Error("isMailerConfigured is required");
  }
  if (typeof sendVerificationCodeEmail !== "function") {
    throw new Error("sendVerificationCodeEmail is required");
  }

  return async function analyticsHandler(req, res) {
    if (!req.url) {
      sendJson(req, res, 404, { ok: false, error: "missing url" });
      return;
    }

    if (req.method === "OPTIONS") {
      sendJson(req, res, 204, { ok: true });
      return;
    }

    const url = new URL(req.url, "http://127.0.0.1");
    const ip = normalizeIpAddress(req);

    try {
      if (req.method === "GET" && url.pathname === "/healthz") {
        sendJson(req, res, 200, { ok: true, mailerConfigured: isMailerConfigured() });
        return;
      }

      if (req.method === "GET" && url.pathname === "/") {
        const normalizedAdminToken = String(adminToken || "").trim();
        if (normalizedAdminToken && getAdminToken(req, url) !== normalizedAdminToken) {
          sendHtml(req, res, 200, renderAdminTokenGateHtml(publicBaseUrl));
          return;
        }
        const db = loadDbImpl();
        sendHtml(
          req,
          res,
          200,
          renderDashboardHtml(
            buildAnalyticsSummary(db),
            buildTimeSeries(db, 14),
            publicBaseUrl,
            getStorageBackendInfo(),
            url.search,
          ),
        );
        return;
      }

      if (req.method === "GET" && url.pathname === "/admin/data") {
        requireAdminToken(req, url, adminToken);
        const db = loadDbImpl();
        sendJson(req, res, 200, {
          ok: true,
          summary: buildAnalyticsSummary(db),
          series: buildTimeSeries(db, 14),
        });
        return;
      }

      if (req.method === "POST" && url.pathname === "/auth/send-verification-code") {
        ensureTrustedBrowserOrigin(req);
        enforceRateLimit(rateLimiter, `send-code:ip:${ip}`, 10, 15 * 60 * 1000);
        if (!isMailerConfigured()) {
          throw new HttpError(400, "mailer is not configured; set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM");
        }
        const body = await readJsonBody(req);
        const email = String(body.email || "").trim().toLowerCase();
        if (!email) {
          throw new HttpError(400, "email is required");
        }
        enforceRateLimit(rateLimiter, `send-code:email:${email}`, 3, 10 * 60 * 1000);
        const { code, expiresAt } = createEmailVerificationCodeImpl(email);
        await sendVerificationCodeEmail(email, code);
        sendJson(req, res, 200, { ok: true, expiresAt });
        return;
      }

      if (req.method === "POST" && url.pathname === "/auth/register") {
        ensureTrustedBrowserOrigin(req);
        enforceRateLimit(rateLimiter, `register:ip:${ip}`, 20, 15 * 60 * 1000);
        const body = await readJsonBody(req);
        verifyEmailCodeImpl(body.email, body.verificationCode);
        const { user, authToken } = createUserImpl(body.email, body.password, body.deviceId);
        sendJson(req, res, 200, {
          ok: true,
          user: { userId: user.userId, email: user.email },
          authToken,
        });
        return;
      }

      if (req.method === "POST" && url.pathname === "/auth/login") {
        ensureTrustedBrowserOrigin(req);
        enforceRateLimit(rateLimiter, `login:ip:${ip}`, 30, 15 * 60 * 1000);
        const body = await readJsonBody(req);
        const { user, authToken } = loginUserImpl(body.email, body.password, body.deviceId);
        sendJson(req, res, 200, {
          ok: true,
          user: { userId: user.userId, email: user.email },
          authToken,
        });
        return;
      }

      if (req.method === "POST" && url.pathname === "/analytics/events") {
        ensureTrustedBrowserOrigin(req);
        enforceRateLimit(rateLimiter, `events:ip:${ip}`, 240, 5 * 60 * 1000);
        const body = await readJsonBody(req);
        if (!body.deviceId || !body.event) {
          throw new HttpError(400, "deviceId and event are required");
        }
        recordAnalyticsEventImpl(body, getBearerToken(req));
        sendJson(req, res, 200, { ok: true });
        return;
      }

      if (req.method === "GET" && url.pathname === "/analytics/summary") {
        requireAdminToken(req, url, adminToken);
        enforceRateLimit(rateLimiter, `summary:ip:${ip}`, 60, 5 * 60 * 1000);
        const db = loadDbImpl();
        sendJson(req, res, 200, { ok: true, summary: buildAnalyticsSummary(db) });
        return;
      }

      if (req.method === "GET" && url.pathname === "/analytics/timeseries") {
        requireAdminToken(req, url, adminToken);
        enforceRateLimit(rateLimiter, `timeseries:ip:${ip}`, 60, 5 * 60 * 1000);
        const days = Math.max(1, Math.min(90, Number(url.searchParams.get("days") || "14")));
        const db = loadDbImpl();
        sendJson(req, res, 200, { ok: true, series: buildTimeSeries(db, days) });
        return;
      }

      sendJson(req, res, 404, { ok: false, error: "not found" });
    } catch (err) {
      const statusCode = err instanceof HttpError ? err.statusCode : 400;
      sendJson(req, res, statusCode, { ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  };
}
