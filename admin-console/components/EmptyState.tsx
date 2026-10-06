import React from "react";
import { InboxIcon } from "./Icons";

interface PlaceholderCardProps {
  label: string;
  statusText?: string;
}

export function MetricPlaceholderCard({
  label,
  statusText = "等待数据接入",
}: PlaceholderCardProps): React.JSX.Element {
  return (
    <div className="admin-metric-card">
      <span className="admin-metric-label">{label}</span>
      <div className="admin-metric-value-wrap">
        <span className="admin-metric-value">—</span>
        <span className="admin-metric-badge">{statusText}</span>
      </div>
    </div>
  );
}

interface EmptyStateCardProps {
  title: string;
  description: string;
}

export function EmptyStateNotice({
  title,
  description,
}: EmptyStateCardProps): React.JSX.Element {
  return (
    <section className="admin-empty-notice" aria-label="数据接入说明">
      <div className="admin-empty-icon-wrap" aria-hidden="true">
        <InboxIcon size={32} />
      </div>
      <div className="admin-empty-text-wrap">
        <h2 className="admin-empty-title">{title}</h2>
        <p className="admin-empty-desc">{description}</p>
      </div>
    </section>
  );
}

interface PlaceholderSectionProps {
  title: string;
  subtitle?: string;
  children?: React.ReactNode;
}

export function PlaceholderSection({
  title,
  subtitle = "功能模块与数据接口接入后展示",
  children,
}: PlaceholderSectionProps): React.JSX.Element {
  return (
    <section className="admin-section-card" aria-label={title}>
      <div className="admin-section-header">
        <h3 className="admin-section-title">{title}</h3>
        <span className="admin-section-subtitle">{subtitle}</span>
      </div>
      <div className="admin-section-body">
        {children || (
          <div className="admin-placeholder-box">
            <span className="admin-placeholder-text">
              暂无数据 · 等待数据接入
            </span>
          </div>
        )}
      </div>
    </section>
  );
}

interface TablePlaceholderProps {
  headers: string[];
  emptyMessage: string;
}

export function TablePlaceholder({
  headers,
  emptyMessage,
}: TablePlaceholderProps): React.JSX.Element {
  return (
    <div className="admin-table-container">
      <table className="admin-table">
        <thead>
          <tr>
            {headers.map((h, i) => (
              <th key={i} scope="col">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            <td colSpan={headers.length} className="admin-table-empty">
              {emptyMessage}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
