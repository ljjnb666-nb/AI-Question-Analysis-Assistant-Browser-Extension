import React from "react";
import type { AdminProviderItem } from "../../types/adminAnalytics";
import {
  formatNumber,
  formatPercent,
  formatProviderName,
} from "../../lib/adminAnalyticsFormat";

export interface ProviderBreakdownProps {
  data: AdminProviderItem[];
}

export function ProviderBreakdown({
  data,
}: ProviderBreakdownProps): React.JSX.Element {
  if (!data || data.length === 0) {
    return (
      <div className="admin-breakdown-empty">
        <p>当前时间范围内暂无解析结果提供商数据</p>
      </div>
    );
  }

  const totalAllOutcomes = data.reduce((acc, row) => acc + row.outcomes, 0);

  return (
    <div className="admin-breakdown-container">
      <div className="admin-table-container">
        <table className="admin-table" aria-label="解析结果提供商分布详细数据">
          <thead>
            <tr>
              <th>提供商</th>
              <th>占比</th>
              <th>成功</th>
              <th>失败</th>
              <th>总计</th>
              <th>观测成功率</th>
            </tr>
          </thead>
          <tbody>
            {data.map((row) => {
              const displayName = formatProviderName(row.provider);
              const share =
                totalAllOutcomes > 0 ? row.outcomes / totalAllOutcomes : 0;
              const barWidth = Math.max(0, Math.min(100, Math.round(share * 100)));

              return (
                <tr key={row.provider}>
                  <td>
                    <strong className="admin-provider-name">{displayName}</strong>
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
                          className="admin-mini-bar-fill admin-fill-accent"
                          rx="4"
                        />
                      </svg>
                      <span className="admin-progress-text">
                        {formatPercent(share)}
                      </span>
                    </div>
                  </td>
                  <td>{formatNumber(row.success)}</td>
                  <td>{formatNumber(row.error)}</td>
                  <td>
                    <strong>{formatNumber(row.outcomes)}</strong>
                  </td>
                  <td>{formatPercent(row.successRatio)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
