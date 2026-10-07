import React, { useState } from "react";
import type { AdminTimeseriesItem } from "../../types/adminAnalytics";
import {
  formatDateShort,
  formatNumber,
  formatPercent,
} from "../../lib/adminAnalyticsFormat";

export interface ParseOutcomesTrendProps {
  data: AdminTimeseriesItem[];
}

export function ParseOutcomesTrend({
  data,
}: ParseOutcomesTrendProps): React.JSX.Element {
  const [showTable, setShowTable] = useState(false);

  if (!data || data.length === 0) {
    return (
      <div className="admin-chart-empty">
        <p>当前时间范围内暂无解析结果数据</p>
      </div>
    );
  }

  const totalSuccess = data.reduce((acc, row) => acc + row.parseSuccesses, 0);
  const totalError = data.reduce((acc, row) => acc + row.parseErrors, 0);
  const totalOutcomes = totalSuccess + totalError;
  const overallRatio =
    totalOutcomes > 0 ? totalSuccess / totalOutcomes : null;

  // Chart dimensions
  const width = 720;
  const height = 200;
  const padLeft = 45;
  const padRight = 15;
  const padTop = 20;
  const padBottom = 30;
  const plotWidth = width - padLeft - padRight;
  const plotHeight = height - padTop - padBottom;

  const maxVal = Math.max(
    1,
    ...data.map((d) => d.parseSuccesses + d.parseErrors),
  );

  const numBars = data.length;
  const barSlotWidth = plotWidth / numBars;
  const barWidth = Math.max(2, Math.min(24, barSlotWidth * 0.7));

  // Determine label step for X axis so labels don't overlap
  const labelStep = numBars > 30 ? 7 : numBars > 14 ? 3 : numBars > 7 ? 2 : 1;

  // Y-axis ticks (4 ticks)
  const yTicks = [0, 0.33, 0.66, 1].map((pct) => ({
    val: Math.round(maxVal * pct),
    y: padTop + plotHeight * (1 - pct),
  }));

  return (
    <div className="admin-chart-container">
      <div className="admin-chart-top-bar">
        <div className="admin-chart-legend">
          <span className="admin-legend-item">
            <span className="admin-legend-color admin-color-success" />
            <span>成功解析结果 ({formatNumber(totalSuccess)})</span>
          </span>
          <span className="admin-legend-item">
            <span className="admin-legend-color admin-color-danger" />
            <span>失败解析结果 ({formatNumber(totalError)})</span>
          </span>
          <span className="admin-legend-summary">
            总计：<strong>{formatNumber(totalOutcomes)}</strong> · 观测成功率：
            <strong>{formatPercent(overallRatio)}</strong>
          </span>
        </div>
        <button
          type="button"
          className="admin-table-toggle-btn"
          onClick={() => setShowTable((v) => !v)}
          aria-expanded={showTable}
        >
          {showTable ? "查看图表" : "查看数据表格"}
        </button>
      </div>

      {!showTable ? (
        <div className="admin-svg-wrapper">
          <svg
            className="admin-chart-svg"
            viewBox={`0 0 ${width} ${height}`}
            role="img"
            aria-label="解析结果趋势图表，展示各日期观测到的成功与失败解析结果"
          >
            {/* Grid lines and Y axis ticks */}
            {yTicks.map((tick, idx) => (
              <g key={idx} className="admin-grid-line-group">
                <line
                  x1={padLeft}
                  y1={tick.y}
                  x2={width - padRight}
                  y2={tick.y}
                  className="admin-grid-line"
                />
                <text
                  x={padLeft - 8}
                  y={tick.y + 4}
                  className="admin-axis-tick-text"
                  textAnchor="end"
                >
                  {formatNumber(tick.val)}
                </text>
              </g>
            ))}

            {/* Stacked bars */}
            {data.map((d, idx) => {
              const xCenter = padLeft + idx * barSlotWidth + barSlotWidth / 2;
              const xLeft = xCenter - barWidth / 2;
              const totalDay = d.parseSuccesses + d.parseErrors;

              const successH =
                totalDay > 0
                  ? (d.parseSuccesses / maxVal) * plotHeight
                  : 0;
              const errorH =
                totalDay > 0
                  ? (d.parseErrors / maxVal) * plotHeight
                  : 0;

              const yBottom = padTop + plotHeight;
              const ySuccess = yBottom - successH;
              const yError = ySuccess - errorH;

              const showLabel =
                idx % labelStep === 0 || idx === numBars - 1;

              return (
                <g key={d.date} className="admin-bar-group">
                  <title>
                    {`${d.date}: 成功 ${d.parseSuccesses}, 失败 ${d.parseErrors} (成功率 ${formatPercent(d.parseOutcomeSuccessRatio)})`}
                  </title>
                  {/* Success bar */}
                  {successH > 0 && (
                    <rect
                      x={xLeft}
                      y={ySuccess}
                      width={barWidth}
                      height={successH}
                      className="admin-bar-success"
                      rx={errorH === 0 ? 2 : 0}
                    />
                  )}
                  {/* Error bar */}
                  {errorH > 0 && (
                    <rect
                      x={xLeft}
                      y={yError}
                      width={barWidth}
                      height={errorH}
                      className="admin-bar-danger"
                      rx={2}
                    />
                  )}
                  {/* X Axis date label */}
                  {showLabel && (
                    <text
                      x={xCenter}
                      y={height - 8}
                      className="admin-axis-date-text"
                      textAnchor="middle"
                    >
                      {formatDateShort(d.date)}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
        </div>
      ) : (
        <div className="admin-table-container">
          <table className="admin-table" aria-label="解析结果详细数据列表">
            <thead>
              <tr>
                <th>日期 (UTC)</th>
                <th>成功解析结果</th>
                <th>失败解析结果</th>
                <th>解析结果总计</th>
                <th>观测成功率</th>
              </tr>
            </thead>
            <tbody>
              {data.map((row) => (
                <tr key={row.date}>
                  <td>{row.date}</td>
                  <td>{formatNumber(row.parseSuccesses)}</td>
                  <td>{formatNumber(row.parseErrors)}</td>
                  <td>{formatNumber(row.parseSuccesses + row.parseErrors)}</td>
                  <td>{formatPercent(row.parseOutcomeSuccessRatio)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export interface ActivityTrendProps {
  data: AdminTimeseriesItem[];
}

export function ActivityTrend({
  data,
}: ActivityTrendProps): React.JSX.Element {
  const [showTable, setShowTable] = useState(false);

  if (!data || data.length === 0) {
    return (
      <div className="admin-chart-empty">
        <p>当前时间范围内暂无活跃设备数据</p>
      </div>
    );
  }

  const width = 720;
  const height = 200;
  const padLeft = 45;
  const padRight = 15;
  const padTop = 20;
  const padBottom = 30;
  const plotWidth = width - padLeft - padRight;
  const plotHeight = height - padTop - padBottom;

  const maxVal = Math.max(
    1,
    ...data.map((d) => Math.max(d.optInDau, d.registrations)),
  );

  const numBars = data.length;
  const barSlotWidth = plotWidth / numBars;
  const barWidth = Math.max(2, Math.min(12, barSlotWidth * 0.35));
  const labelStep = numBars > 30 ? 7 : numBars > 14 ? 3 : numBars > 7 ? 2 : 1;

  const yTicks = [0, 0.33, 0.66, 1].map((pct) => ({
    val: Math.round(maxVal * pct),
    y: padTop + plotHeight * (1 - pct),
  }));

  const totalDauSum = data.reduce((acc, row) => acc + row.optInDau, 0);
  const totalRegs = data.reduce((acc, row) => acc + row.registrations, 0);

  return (
    <div className="admin-chart-container">
      <div className="admin-chart-top-bar">
        <div className="admin-chart-legend">
          <span className="admin-legend-item">
            <span className="admin-legend-color admin-color-accent" />
            <span>已授权活跃设备 (optInDau)</span>
          </span>
          <span className="admin-legend-item">
            <span className="admin-legend-color admin-color-purple" />
            <span>新注册账号 (registrations)</span>
          </span>
          <span className="admin-legend-summary">
            已授权活跃设备累积记录：<strong>{formatNumber(totalDauSum)}</strong> ·
            新注册账号总计：<strong>{formatNumber(totalRegs)}</strong>
          </span>
        </div>
        <button
          type="button"
          className="admin-table-toggle-btn"
          onClick={() => setShowTable((v) => !v)}
          aria-expanded={showTable}
        >
          {showTable ? "查看图表" : "查看数据表格"}
        </button>
      </div>

      {!showTable ? (
        <div className="admin-svg-wrapper">
          <svg
            className="admin-chart-svg"
            viewBox={`0 0 ${width} ${height}`}
            role="img"
            aria-label="活跃设备与新注册账号趋势图表"
          >
            {/* Grid lines and Y axis ticks */}
            {yTicks.map((tick, idx) => (
              <g key={idx} className="admin-grid-line-group">
                <line
                  x1={padLeft}
                  y1={tick.y}
                  x2={width - padRight}
                  y2={tick.y}
                  className="admin-grid-line"
                />
                <text
                  x={padLeft - 8}
                  y={tick.y + 4}
                  className="admin-axis-tick-text"
                  textAnchor="end"
                >
                  {formatNumber(tick.val)}
                </text>
              </g>
            ))}

            {/* Bars for DAU and Registrations side by side */}
            {data.map((d, idx) => {
              const xCenter = padLeft + idx * barSlotWidth + barSlotWidth / 2;
              const xDau = xCenter - barWidth - 1;
              const xReg = xCenter + 1;

              const dauH = (d.optInDau / maxVal) * plotHeight;
              const regH = (d.registrations / maxVal) * plotHeight;

              const yBottom = padTop + plotHeight;
              const yDau = yBottom - dauH;
              const yReg = yBottom - regH;

              const showLabel =
                idx % labelStep === 0 || idx === numBars - 1;

              return (
                <g key={d.date} className="admin-bar-group">
                  <title>
                    {`${d.date}: 已授权活跃设备 ${d.optInDau}, 新注册账号 ${d.registrations}`}
                  </title>
                  {/* DAU bar */}
                  {dauH > 0 && (
                    <rect
                      x={xDau}
                      y={yDau}
                      width={barWidth}
                      height={dauH}
                      className="admin-bar-accent"
                      rx={2}
                    />
                  )}
                  {/* Reg bar */}
                  {regH > 0 && (
                    <rect
                      x={xReg}
                      y={yReg}
                      width={barWidth}
                      height={regH}
                      className="admin-bar-purple"
                      rx={2}
                    />
                  )}
                  {/* X Axis date label */}
                  {showLabel && (
                    <text
                      x={xCenter}
                      y={height - 8}
                      className="admin-axis-date-text"
                      textAnchor="middle"
                    >
                      {formatDateShort(d.date)}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
        </div>
      ) : (
        <div className="admin-table-container">
          <table className="admin-table" aria-label="活跃设备与新注册详细数据列表">
            <thead>
              <tr>
                <th>日期 (UTC)</th>
                <th>已授权活跃设备 (optInDau)</th>
                <th>观测安装设备 (installDevices)</th>
                <th>新注册账号 (registrations)</th>
              </tr>
            </thead>
            <tbody>
              {data.map((row) => (
                <tr key={row.date}>
                  <td>{row.date}</td>
                  <td>{formatNumber(row.optInDau)}</td>
                  <td>{formatNumber(row.observedInstallDevices)}</td>
                  <td>{formatNumber(row.registrations)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
