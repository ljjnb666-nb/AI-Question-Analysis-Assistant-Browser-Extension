import React from "react";
import type { AdminErrorItem } from "../../types/adminAnalytics";
import {
  formatErrorCategory,
  formatNumber,
  formatPercent,
} from "../../lib/adminAnalyticsFormat";

export interface ErrorBreakdownProps {
  data: AdminErrorItem[];
}

export function ErrorBreakdown({
  data,
}: ErrorBreakdownProps): React.JSX.Element {
  if (!data || data.length === 0) {
    return (
      <div className="admin-breakdown-empty">
        <p>当前时间范围内暂无解析错误数据</p>
      </div>
    );
  }

  const totalErrors = data.reduce((acc, row) => acc + row.count, 0);

  return (
    <div className="admin-breakdown-container">
      <div className="admin-table-container">
        <table className="admin-table" aria-label="解析错误分类详细数据">
          <thead>
            <tr>
              <th>错误分类</th>
              <th>占比</th>
              <th>错误次数</th>
              <th>终止重试次数</th>
            </tr>
          </thead>
          <tbody>
            {data.map((row) => {
              const displayName = formatErrorCategory(row.category);
              const share = totalErrors > 0 ? row.count / totalErrors : 0;
              const barWidth = Math.max(0, Math.min(100, Math.round(share * 100)));

              return (
                <tr key={row.category}>
                  <td>
                    <strong className="admin-error-name">{displayName}</strong>
                  </td>
                  <td className="admin-table-share-cell">
                    <div className="admin-progress-wrap">
                      <svg
                        className="admin-mini-bar-svg"
                        viewBox="0 0 100 8"
                        preserveAspectRatio="none"
                        aria-hidden="true"
                      >
                        <rect
                          x="0"
                          y="0"
                          width="100"
                          height="8"
                          className="admin-mini-bar-bg"
                          rx="4"
                        />
                        <rect
                          x="0"
                          y="0"
                          width={barWidth}
                          height="8"
                          className="admin-mini-bar-fill admin-fill-danger"
                          rx="4"
                        />
                      </svg>
                      <span className="admin-progress-text">
                        {formatPercent(share)}
                      </span>
                    </div>
                  </td>
                  <td>{formatNumber(row.count)}</td>
                  <td>{formatNumber(row.exhaustedCount)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
