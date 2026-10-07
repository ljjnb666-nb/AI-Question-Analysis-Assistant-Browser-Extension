import React from "react";

export interface MetricCardProps {
  label: string;
  value: string;
  badge?: string | null;
  hint?: string | null;
  loading?: boolean;
  className?: string;
}

export function MetricCard({
  label,
  value,
  badge,
  hint,
  loading = false,
  className = "",
}: MetricCardProps): React.JSX.Element {
  if (loading) {
    return (
      <article
        className={`admin-metric-card admin-metric-card-loading ${className}`}
        aria-busy="true"
        aria-label={`${label} 加载中`}
      >
        <span className="admin-metric-label">{label}</span>
        <div className="admin-metric-value-wrap">
          <div className="admin-skeleton admin-skeleton-value" aria-hidden="true" />
          {badge && (
            <div
              className="admin-skeleton admin-skeleton-badge"
              aria-hidden="true"
            />
          )}
        </div>
        {hint && (
          <div
            className="admin-skeleton admin-skeleton-hint"
            aria-hidden="true"
          />
        )}
      </article>
    );
  }

  return (
    <article className={`admin-metric-card ${className}`}>
      <span className="admin-metric-label">{label}</span>
      <div className="admin-metric-value-wrap">
        <strong className="admin-metric-value">{value}</strong>
        {badge && <span className="admin-metric-badge">{badge}</span>}
      </div>
      {hint && <span className="admin-metric-hint">{hint}</span>}
    </article>
  );
}
