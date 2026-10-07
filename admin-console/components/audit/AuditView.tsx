import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertCircleIcon,
  AuditIcon,
  InboxIcon,
  RefreshIcon,
} from "../Icons";
import { fetchAdminAudit } from "../../lib/adminAuditApi";
import { formatAdminDateTime } from "../../lib/adminManagementFormat";
import type { AdminAuditItem } from "../../types/adminAudit";

function eventLabel(event: string): string {
  switch (event) {
    case "admin_login":
      return "管理员登录";
    case "admin_logout":
      return "管理员退出";
    case "admin_csrf_rejected":
      return "CSRF 拒绝";
    case "admin_origin_rejected":
      return "来源拒绝";
    case "admin_mutation_rejected":
      return "未支持的管理变更";
    default:
      return "其他安全事件";
  }
}

function outcomeLabel(outcome: string): string {
  switch (outcome) {
    case "success":
      return "成功";
    case "failure":
      return "失败";
    case "rejected":
      return "已拒绝";
    default:
      return "未知";
  }
}

function errorMessage(error: unknown): string {
  const code = error instanceof Error ? error.message : "";
  switch (code) {
    case "ADMIN_RATE_LIMITED":
      return "请求过于频繁，请稍后重试";
    case "ADMIN_AUTH_NOT_CONFIGURED":
      return "管理后台认证尚未配置";
    case "ADMIN_STORAGE_UNAVAILABLE":
    case "ADMIN_INTERNAL_ERROR":
    default:
      return "审计记录暂时不可用";
  }
}

function reasonLabel(reason: string | undefined): string | undefined {
  switch (reason) {
    case "invalid_credentials":
      return "凭据无效";
    case "origin_mismatch":
      return "来源不匹配";
    case "admin_csrf_rejected":
      return "CSRF 校验失败";
    case "admin_csrf_required":
      return "缺少 CSRF 凭据";
    case "unsupported_mutation":
      return "未支持的管理变更";
    default:
      return undefined;
  }
}

function detailText(item: AdminAuditItem): string {
  const parts = [
    item.metadata?.method,
    item.metadata?.path,
    reasonLabel(item.metadata?.reason),
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : "—";
}

export function AuditView(): React.JSX.Element {
  const [items, setItems] = useState<AdminAuditItem[]>([]);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);
  const firstControllerRef = useRef<AbortController | null>(null);
  const moreControllerRef = useRef<AbortController | null>(null);
  const loadingMoreRef = useRef(false);

  const loadFirstPage = useCallback(() => {
    firstControllerRef.current?.abort();
    moreControllerRef.current?.abort();
    loadingMoreRef.current = false;
    setLoadingMore(false);
    setLoadMoreError(null);

    const controller = new AbortController();
    firstControllerRef.current = controller;
    setLoading(true);
    setError(null);

    void fetchAdminAudit({ signal: controller.signal })
      .then((response) => {
        if (controller.signal.aborted) return;
        setItems(response.data);
        setGeneratedAt(response.generatedAt);
        setNextCursor(response.page.nextCursor);
        setLoading(false);
      })
      .catch((fetchError: unknown) => {
        if (controller.signal.aborted) return;
        setError(errorMessage(fetchError));
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    loadFirstPage();
    return () => {
      firstControllerRef.current?.abort();
      moreControllerRef.current?.abort();
    };
  }, [loadFirstPage]);

  const loadMore = useCallback(() => {
    if (!nextCursor || loading || loadingMoreRef.current) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    setLoadMoreError(null);

    const controller = new AbortController();
    moreControllerRef.current = controller;

    void fetchAdminAudit({ cursor: nextCursor, signal: controller.signal })
      .then((response) => {
        if (controller.signal.aborted) return;
        setItems((current) => [...current, ...response.data]);
        setGeneratedAt(response.generatedAt);
        setNextCursor(response.page.nextCursor);
        setLoadingMore(false);
        loadingMoreRef.current = false;
      })
      .catch((fetchError: unknown) => {
        if (controller.signal.aborted) return;
        setLoadMoreError(errorMessage(fetchError));
        setLoadingMore(false);
        loadingMoreRef.current = false;
      });
  }, [loading, nextCursor]);

  return (
    <div className="admin-view-container">
      <div className="admin-audit-toolbar-card">
        <div className="admin-audit-toolbar-title">
          <AuditIcon size={18} />
          <span>安全审计流水</span>
        </div>
        <div className="admin-users-actions">
          {generatedAt && (
            <span className="admin-toolbar-timestamp">
              数据生成时间: {formatAdminDateTime(generatedAt)}
            </span>
          )}
          <button
            type="button"
            className="admin-refresh-btn"
            onClick={loadFirstPage}
            disabled={loading}
            aria-label="刷新审计记录"
          >
            <RefreshIcon size={14} className={loading ? "admin-spin-icon" : ""} />
            <span>刷新</span>
          </button>
        </div>
      </div>

      <section className="admin-section-card" aria-label="安全与操作审计流水">
        <div className="admin-section-header">
          <h2 className="admin-section-title">安全与操作审计流水</h2>
          <span className="admin-section-subtitle">
            仅记录管理后台安全事件与会话变更，不记录口令、Cookie、CSRF Token、邮箱或设备标识
          </span>
        </div>
        <div className="admin-section-body">
          {loading && (
            <div className="admin-section-state-box" aria-busy="true">
              <div className="admin-spinner" aria-hidden="true" />
              <span className="admin-section-loading-text">正在加载审计记录…</span>
            </div>
          )}

          {!loading && error && (
            <div className="admin-section-state-box admin-section-state-error" role="alert">
              <AlertCircleIcon size={24} />
              <p className="admin-section-error-text">{error}</p>
              <button type="button" className="admin-section-retry-btn" onClick={loadFirstPage}>
                <RefreshIcon size={14} />
                <span>重试</span>
              </button>
            </div>
          )}

          {!loading && !error && items.length === 0 && (
            <div className="admin-section-state-box admin-section-state-empty">
              <InboxIcon size={28} />
              <p className="admin-section-empty-text">暂无审计记录</p>
              <span className="admin-empty-subtext">发生管理员登录、退出或安全拒绝事件后将在此展示</span>
            </div>
          )}

          {!loading && !error && items.length > 0 && (
            <div className="admin-audit-container">
              <div className="admin-table-container admin-desktop-only">
                <table className="admin-table admin-audit-table">
                  <thead>
                    <tr>
                      <th scope="col">记录时间</th>
                      <th scope="col">事件</th>
                      <th scope="col">结果</th>
                      <th scope="col">来源标记</th>
                      <th scope="col">会话标记</th>
                      <th scope="col">安全上下文</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item) => (
                      <tr key={item.auditId}>
                        <td>{formatAdminDateTime(item.createdAt)}</td>
                        <td>{eventLabel(item.event)}</td>
                        <td>
                          <span className={`admin-audit-outcome admin-audit-outcome-${item.outcome}`}>
                            {outcomeLabel(item.outcome)}
                          </span>
                        </td>
                        <td><code className="admin-audit-tag">{item.ipHash ?? "—"}</code></td>
                        <td><code className="admin-audit-tag">{item.sessionTag ?? "—"}</code></td>
                        <td className="admin-audit-detail">{detailText(item)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="admin-mobile-only admin-mobile-audit-list">
                {items.map((item) => (
                  <article key={item.auditId} className="admin-mobile-audit-card">
                    <div className="admin-mobile-audit-header">
                      <strong>{eventLabel(item.event)}</strong>
                      <span className={`admin-audit-outcome admin-audit-outcome-${item.outcome}`}>
                        {outcomeLabel(item.outcome)}
                      </span>
                    </div>
                    <div className="admin-mobile-user-card-row">
                      <span className="admin-mobile-field-label">记录时间:</span>
                      <span className="admin-mobile-field-value">{formatAdminDateTime(item.createdAt)}</span>
                    </div>
                    <div className="admin-mobile-user-card-row">
                      <span className="admin-mobile-field-label">来源标记:</span>
                      <code className="admin-audit-tag">{item.ipHash ?? "—"}</code>
                    </div>
                    <div className="admin-mobile-user-card-row">
                      <span className="admin-mobile-field-label">会话标记:</span>
                      <code className="admin-audit-tag">{item.sessionTag ?? "—"}</code>
                    </div>
                    <div className="admin-mobile-user-card-row">
                      <span className="admin-mobile-field-label">安全上下文:</span>
                      <span className="admin-mobile-field-value">{detailText(item)}</span>
                    </div>
                  </article>
                ))}
              </div>

              {nextCursor && (
                <div className="admin-load-more-section">
                  <button
                    type="button"
                    className="admin-load-more-btn"
                    onClick={loadMore}
                    disabled={loadingMore}
                    aria-busy={loadingMore}
                  >
                    <span>{loadingMore ? "正在加载更多…" : "加载更多"}</span>
                  </button>
                  {loadMoreError && (
                    <div className="admin-load-more-error" role="alert">
                      <AlertCircleIcon size={14} />
                      <span>{loadMoreError}</span>
                      <button type="button" className="admin-load-more-retry-btn" onClick={loadMore}>
                        重试
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
