import React from "react";
import type { AdminAnalyticsDays } from "../../types/adminAnalytics";
import { formatTime } from "../../lib/adminAnalyticsFormat";
import { CalendarIcon, RefreshIcon } from "../Icons";

export interface AnalyticsToolbarProps {
  days: AdminAnalyticsDays;
  onDaysChange: (days: AdminAnalyticsDays) => void;
  onRefresh: () => void;
  loading?: boolean;
  generatedAt?: string | null;
  label?: string;
}

const TIME_OPTIONS: Array<{ value: AdminAnalyticsDays; label: string }> = [
  { value: 7, label: "7 天" },
  { value: 14, label: "14 天" },
  { value: 30, label: "30 天" },
  { value: 90, label: "90 天" },
];

export function AnalyticsToolbar({
  days,
  onDaysChange,
  onRefresh,
  loading = false,
  generatedAt = null,
  label = "时间范围",
}: AnalyticsToolbarProps): React.JSX.Element {
  const timeFormatted = formatTime(generatedAt);

  return (
    <div className="admin-toolbar" aria-label="数据控制工具栏">
      <div className="admin-toolbar-left">
        <div className="admin-time-selector" role="group" aria-label={label}>
          <span className="admin-toolbar-icon" aria-hidden="true">
            <CalendarIcon size={16} />
          </span>
          <span className="admin-toolbar-label">{label}</span>
          <div className="admin-segmented-group" role="radiogroup" aria-label="时间周期选择">
            {TIME_OPTIONS.map((opt) => {
              const isSelected = days === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  role="radio"
                  aria-checked={isSelected}
                  className={`admin-segmented-btn ${isSelected ? "is-selected" : ""}`}
                  onClick={() => onDaysChange(opt.value)}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="admin-toolbar-right">
        {timeFormatted && (
          <span className="admin-toolbar-timestamp" title={`生成于 ${generatedAt ?? ""}`}>
            数据生成时间：{timeFormatted}
          </span>
        )}
        <button
          type="button"
          className="admin-refresh-btn"
          onClick={onRefresh}
          disabled={loading}
          aria-label={loading ? "正在刷新数据" : "刷新数据"}
        >
          <RefreshIcon
            size={14}
            className={loading ? "admin-spin-icon" : ""}
          />
          <span>{loading ? "刷新中…" : "刷新数据"}</span>
        </button>
      </div>
    </div>
  );
}
