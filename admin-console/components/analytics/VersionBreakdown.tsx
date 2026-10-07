import React from "react";
import type { AdminVersionItem } from "../../types/adminAnalytics";
import { formatNumber, formatPercent } from "../../lib/adminAnalyticsFormat";

export interface VersionBreakdownProps {
  data: AdminVersionItem[];
}

export function VersionBreakdown({
  data,
}: VersionBreakdownProps): React.JSX.Element {
  if (!data || data.length === 0) {
    return (
      <div className="admin-breakdown-empty">
        <p>当前时间范围内暂无版本数据</p>
      </div>
    );
  }

  const totalDevices = data.reduce((acc, row) => acc + row.devices, 0);

  return (
    <div className="admin-breakdown-container">
      <div className="admin-table-container">
        <table className="admin-table" aria-label="最新观测扩展版本分布详细数据">
          <thead>
            <tr>
              <th>扩展版本</th>
              <th>占比</th>
              <th>已授权设备数</th>
            </tr>
          </thead>
          <tbody>
            {data.map((row) => {
              const share = totalDevices > 0 ? row.devices / totalDevices : 0;
              const barWidth = Math.max(0, Math.min(100, Math.round(share * 100)));

              return (
                <tr key={row.extensionVersion}>
                  <td>
                    <code className="admin-version-tag">{row.extensionVersion}</code>
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
                          className="admin-mini-bar-fill admin-fill-teal"
                          rx="4"
                        />
                      </svg>
                      <span className="admin-progress-text">
                        {formatPercent(share)}
                      </span>
                    </div>
                  </td>
                  <td>
                    <strong>{formatNumber(row.devices)}</strong>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
