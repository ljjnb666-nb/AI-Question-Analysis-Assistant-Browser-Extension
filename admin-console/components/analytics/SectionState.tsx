import React from "react";
import { AlertCircleIcon, InboxIcon, RefreshIcon } from "../Icons";

export interface SectionStateProps {
  loading?: boolean;
  error?: string | null;
  empty?: boolean;
  emptyMessage?: string;
  onRetry?: () => void;
  children: React.ReactNode;
  minHeight?: string;
}

export function SectionState({
  loading = false,
  error = null,
  empty = false,
  emptyMessage = "当前时间范围内暂无可展示数据",
  onRetry,
  children,
}: SectionStateProps): React.JSX.Element {
  if (loading) {
    return (
      <div className="admin-section-state-box" aria-busy="true">
        <div className="admin-spinner" aria-hidden="true" />
        <span className="admin-section-loading-text">正在加载数据…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="admin-section-state-box admin-section-state-error" role="alert">
        <div className="admin-state-icon-error" aria-hidden="true">
          <AlertCircleIcon size={24} />
        </div>
        <p className="admin-section-error-text">{error}</p>
        {onRetry && (
          <button
            type="button"
            className="admin-section-retry-btn"
            onClick={onRetry}
          >
            <RefreshIcon size={14} />
            <span>重试</span>
          </button>
        )}
      </div>
    );
  }

  if (empty) {
    return (
      <div className="admin-section-state-box admin-section-state-empty">
        <div className="admin-state-icon-empty" aria-hidden="true">
          <InboxIcon size={28} />
        </div>
        <p className="admin-section-empty-text">{emptyMessage}</p>
      </div>
    );
  }

  return <>{children}</>;
}
