import React, { useState } from "react";
import type { AdminLatencyItem } from "../../types/adminAnalytics";
import {
  formatDateShort,
  formatDuration,
  formatNumber,
} from "../../lib/adminAnalyticsFormat";

export interface LatencyChartProps {
  data: AdminLatencyItem[];
}

export function LatencyChart({ data }: LatencyChartProps): React.JSX.Element {
  const [showTable, setShowTable] = useState(false);

  if (!data || data.length === 0) {
    return (
      <div className="admin-chart-empty">
        <p>当前时间范围内暂无耗时数据</p>
      </div>
    );
  }

  // Calculate overall window metrics
  let totalSamples = 0;
  let weightedDurationSum = 0;
  data.forEach((d) => {
    if (d.samples > 0 && d.averageMs != null) {
      totalSamples += d.samples;
      weightedDurationSum += d.averageMs * d.samples;
    }
  });
  const overallAvgMs =
    totalSamples > 0 ? weightedDurationSum / totalSamples : null;

  const width = 720;
  const height = 200;
  const padLeft = 55;
  const padRight = 15;
  const padTop = 20;
  const padBottom = 30;
  const plotWidth = width - padLeft - padRight;
  const plotHeight = height - padTop - padBottom;

  const validPoints = data.filter(
    (d) => d.samples > 0 && d.averageMs != null && Number.isFinite(d.averageMs),
  );

  const maxMs =
    validPoints.length > 0
      ? Math.max(100, ...validPoints.map((d) => d.averageMs as number))
      : 1000;

  const numItems = data.length;
  const slotWidth = numItems > 1 ? plotWidth / (numItems - 1) : plotWidth;
  const labelStep = numItems > 30 ? 7 : numItems > 14 ? 3 : numItems > 7 ? 2 : 1;

  // Y-axis ticks (4 ticks)
  const yTicks = [0, 0.33, 0.66, 1].map((pct) => ({
    val: Math.round(maxMs * pct),
    y: padTop + plotHeight * (1 - pct),
  }));

  // Build SVG polyline for connected valid points
  const pointsString = data
    .map((d, idx) => {
      if (d.samples === 0 || d.averageMs == null) return null;
      const x = padLeft + (numItems > 1 ? idx * slotWidth : plotWidth / 2);
      const y = padTop + plotHeight * (1 - Math.min(1, d.averageMs / maxMs));
      return `${x},${y}`;
    })
    .filter((pt): pt is string => pt !== null)
    .join(" ");

  return (
    <div className="admin-chart-container">
      <div className="admin-chart-top-bar">
        <div className="admin-chart-legend">
          <span className="admin-legend-item">
            <span className="admin-legend-color admin-color-warning" />
            <span>平均观测解析耗时</span>
          </span>
          <span className="admin-legend-summary">
            观测样本数：<strong>{formatNumber(totalSamples)}</strong> ·
            窗口平均耗时：
            <strong>{formatDuration(overallAvgMs, "暂无样本")}</strong>
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
            aria-label="观测解析耗时趋势图表"
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
                  {formatDuration(tick.val)}
                </text>
              </g>
            ))}

            {/* Polyline */}
            {pointsString && (
              <polyline
                points={pointsString}
                className="admin-line-warning"
                fill="none"
              />
            )}

            {/* Data points */}
            {data.map((d, idx) => {
              const x =
                padLeft + (numItems > 1 ? idx * slotWidth : plotWidth / 2);
              const showLabel =
                idx % labelStep === 0 || idx === numItems - 1;

              const hasSample = d.samples > 0 && d.averageMs != null;
              const y = hasSample
                ? padTop +
                  plotHeight * (1 - Math.min(1, (d.averageMs as number) / maxMs))
                : padTop + plotHeight;

              return (
                <g key={d.date} className="admin-point-group">
                  <title>
                    {hasSample
                      ? `${d.date}: 平均 ${formatDuration(d.averageMs)}, 样本 ${d.samples}`
                      : `${d.date}: 暂无样本`}
                  </title>
                  {hasSample ? (
                    <circle
                      cx={x}
                      cy={y}
                      r="4"
                      className="admin-point-circle admin-fill-warning"
                    />
                  ) : (
                    <circle
                      cx={x}
                      cy={y}
                      r="2"
                      className="admin-point-empty"
                    />
                  )}
                  {showLabel && (
                    <text
                      x={x}
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
          <table className="admin-table" aria-label="观测解析耗时详细数据列表">
            <thead>
              <tr>
                <th>日期 (UTC)</th>
                <th>样本数</th>
                <th>平均观测解析耗时</th>
              </tr>
            </thead>
            <tbody>
              {data.map((row) => (
                <tr key={row.date}>
                  <td>{row.date}</td>
                  <td>{formatNumber(row.samples)}</td>
                  <td>{formatDuration(row.averageMs, "暂无样本")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
