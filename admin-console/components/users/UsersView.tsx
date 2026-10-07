import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  SearchIcon,
  RefreshIcon,
  AlertCircleIcon,
  InboxIcon,
  XIcon,
} from "../Icons";
import { fetchAdminUsers } from "../../lib/adminManagementApi";
import {
  formatAdminDateTime,
  getUsersErrorMessage,
} from "../../lib/adminManagementFormat";
import type { AdminUserListItem } from "../../types/adminManagement";

export function UsersView(): React.JSX.Element {
  const [users, setUsers] = useState<AdminUserListItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [loadingMore, setLoadingMore] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);

  // Search input state (local draft) and committed query
  const [searchInput, setSearchInput] = useState<string>("");
  const [query, setQuery] = useState<string>("");

  // Single-flight and abort controllers
  const abortControllerRef = useRef<AbortController | null>(null);
  const loadMoreAbortControllerRef = useRef<AbortController | null>(null);
  const isLoadingMoreRef = useRef<boolean>(false);

  // First page loader
  const loadFirstPage = useCallback((searchQuery: string) => {
    // Abort previous in-flight first-page request
    abortControllerRef.current?.abort();
    loadMoreAbortControllerRef.current?.abort();
    isLoadingMoreRef.current = false;

    const controller = new AbortController();
    abortControllerRef.current = controller;
    const signal = controller.signal;

    setLoading(true);
    setError(null);
    setLoadMoreError(null);

    fetchAdminUsers({
      limit: 50,
      cursor: null,
      q: searchQuery.trim() ? searchQuery.trim() : null,
      signal,
    })
      .then((res) => {
        if (signal.aborted) return;
        setUsers(res.data);
        setNextCursor(res.page.nextCursor);
        setGeneratedAt(res.generatedAt);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (signal.aborted) return;
        setError(getUsersErrorMessage(err));
        setLoading(false);
      });
  }, []);

  // Load more loader
  const handleLoadMore = useCallback(() => {
    if (!nextCursor || isLoadingMoreRef.current || loading) return;

    isLoadingMoreRef.current = true;
    setLoadingMore(true);
    setLoadMoreError(null);

    const controller = new AbortController();
    loadMoreAbortControllerRef.current = controller;
    const signal = controller.signal;

    fetchAdminUsers({
      limit: 50,
      cursor: nextCursor,
      q: query.trim() ? query.trim() : null,
      signal,
    })
      .then((res) => {
        if (signal.aborted) return;
        setUsers((prev) => [...prev, ...res.data]);
        setNextCursor(res.page.nextCursor);
        setGeneratedAt(res.generatedAt);
        setLoadingMore(false);
        isLoadingMoreRef.current = false;
      })
      .catch((err: unknown) => {
        if (signal.aborted) return;
        setLoadMoreError(getUsersErrorMessage(err));
        setLoadingMore(false);
        isLoadingMoreRef.current = false;
      });
  }, [nextCursor, loading, query]);

  // Initial load
  useEffect(() => {
    loadFirstPage(query);
    return () => {
      abortControllerRef.current?.abort();
      loadMoreAbortControllerRef.current?.abort();
    };
  }, [query, loadFirstPage]);

  // Handle search form submit
  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = searchInput.trim();
    if (trimmed !== query) {
      setQuery(trimmed);
    } else {
      loadFirstPage(trimmed);
    }
  };

  // Handle clear search
  const handleClearSearch = () => {
    setSearchInput("");
    if (query !== "") {
      setQuery("");
    } else {
      loadFirstPage("");
    }
  };

  const handleRefresh = () => {
    loadFirstPage(query);
  };

  const isSearching = Boolean(query.trim());

  return (
    <div className="admin-view-container">
      {/* Search Bar & Header Toolbar */}
      <div className="admin-users-toolbar-card">
        <form
          className="admin-users-search-form"
          onSubmit={handleSearchSubmit}
          role="search"
          aria-label="用户搜索"
        >
          <div className="admin-search-input-wrap">
            <SearchIcon size={16} className="admin-search-icon" />
            <input
              type="text"
              className="admin-search-input"
              placeholder="搜索邮箱或用户 ID"
              aria-label="搜索邮箱或用户 ID"
              value={searchInput}
              maxLength={120}
              onChange={(e) => setSearchInput(e.target.value)}
            />
            {searchInput && (
              <button
                type="button"
                className="admin-search-clear-btn"
                onClick={handleClearSearch}
                aria-label="清除搜索输入"
              >
                <XIcon size={14} />
              </button>
            )}
          </div>
          <button
            type="submit"
            className="admin-search-submit-btn"
            disabled={loading}
          >
            搜索
          </button>
          {isSearching && (
            <button
              type="button"
              className="admin-search-reset-btn"
              onClick={handleClearSearch}
              disabled={loading}
            >
              重置
            </button>
          )}
        </form>

        <div className="admin-users-actions">
          {generatedAt && (
            <span className="admin-toolbar-timestamp">
              数据生成时间: {formatAdminDateTime(generatedAt)}
            </span>
          )}
          <button
            type="button"
            className="admin-refresh-btn"
            onClick={handleRefresh}
            disabled={loading}
            aria-label="刷新用户数据"
          >
            <RefreshIcon
              size={14}
              className={loading ? "admin-spin-icon" : ""}
            />
            <span>刷新</span>
          </button>
        </div>
      </div>

      {/* Main Content Section */}
      <section className="admin-section-card" aria-label="用户列表">
        <div className="admin-section-header">
          <h2 className="admin-section-title">
            {isSearching ? `搜索结果: "${query}"` : "已注册用户与设备"}
          </h2>
          <span className="admin-section-subtitle">
            {isSearching
              ? "匹配当前邮箱或用户 ID 关键字的注册用户目录"
              : "展示已注册账号及其当前关联设备数量与最近观测时间"}
          </span>
        </div>

        <div className="admin-section-body">
          {/* 1. Loading State */}
          {loading && (
            <div className="admin-section-state-box" aria-busy="true">
              <div className="admin-spinner" aria-hidden="true" />
              <span className="admin-section-loading-text">正在加载用户数据…</span>
            </div>
          )}

          {/* 2. Error State */}
          {!loading && error && (
            <div
              className="admin-section-state-box admin-section-state-error"
              role="alert"
            >
              <div className="admin-state-icon-error" aria-hidden="true">
                <AlertCircleIcon size={24} />
              </div>
              <p className="admin-section-error-text">{error}</p>
              <button
                type="button"
                className="admin-section-retry-btn"
                onClick={handleRefresh}
              >
                <RefreshIcon size={14} />
                <span>重试</span>
              </button>
            </div>
          )}

          {/* 3. Empty State */}
          {!loading && !error && users.length === 0 && (
            <div className="admin-section-state-box admin-section-state-empty">
              <div className="admin-state-icon-empty" aria-hidden="true">
                <InboxIcon size={28} />
              </div>
              <p className="admin-section-empty-text">
                {isSearching ? "暂无匹配用户" : "暂无已注册用户"}
              </p>
              <span className="admin-empty-subtext">
                {isSearching
                  ? `未找到包含 "${query}" 的用户记录，请尝试其他关键词`
                  : "当前系统内暂无已注册账号记录"}
              </span>
            </div>
          )}

          {/* 4. Loaded Data Table & Cards */}
          {!loading && !error && users.length > 0 && (
            <div className="admin-users-container">
              {/* Desktop Table */}
              <div className="admin-table-container admin-desktop-only">
                <table className="admin-table admin-users-table">
                  <thead>
                    <tr>
                      <th scope="col">账号</th>
                      <th scope="col">用户 ID</th>
                      <th scope="col">注册时间</th>
                      <th scope="col">关联设备</th>
                      <th scope="col">最近设备观测</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map((user) => (
                      <tr key={user.userId}>
                        <td>
                          <span className="admin-user-email" title={user.email}>
                            {user.email}
                          </span>
                        </td>
                        <td>
                          <code className="admin-user-id" title={user.userId}>
                            {user.userId}
                          </code>
                        </td>
                        <td>{formatAdminDateTime(user.createdAt)}</td>
                        <td>
                          <span className="admin-device-badge">
                            {user.linkedDeviceCount}
                          </span>
                        </td>
                        <td>
                          <span
                            className={
                              user.latestDeviceSeenAt
                                ? "admin-seen-time"
                                : "admin-unseen-text"
                            }
                          >
                            {formatAdminDateTime(
                              user.latestDeviceSeenAt,
                              "暂无观测",
                            )}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobile Stacked Cards */}
              <div className="admin-mobile-user-list admin-mobile-only">
                {users.map((user) => (
                  <div key={user.userId} className="admin-mobile-user-card">
                    <div className="admin-mobile-user-card-header">
                      <span className="admin-user-email">{user.email}</span>
                      <span className="admin-device-badge">
                        关联设备: {user.linkedDeviceCount}
                      </span>
                    </div>
                    <div className="admin-mobile-user-card-row">
                      <span className="admin-mobile-field-label">用户 ID:</span>
                      <code className="admin-user-id">{user.userId}</code>
                    </div>
                    <div className="admin-mobile-user-card-row">
                      <span className="admin-mobile-field-label">注册时间:</span>
                      <span className="admin-mobile-field-value">
                        {formatAdminDateTime(user.createdAt)}
                      </span>
                    </div>
                    <div className="admin-mobile-user-card-row">
                      <span className="admin-mobile-field-label">
                        最近设备观测:
                      </span>
                      <span
                        className={
                          user.latestDeviceSeenAt
                            ? "admin-mobile-field-value"
                            : "admin-unseen-text"
                        }
                      >
                        {formatAdminDateTime(
                          user.latestDeviceSeenAt,
                          "暂无观测",
                        )}
                      </span>
                    </div>
                  </div>
                ))}
              </div>

              {/* Load More Section */}
              {nextCursor && (
                <div className="admin-load-more-section">
                  <button
                    type="button"
                    className="admin-load-more-btn"
                    onClick={handleLoadMore}
                    disabled={loadingMore}
                    aria-busy={loadingMore}
                  >
                    {loadingMore && (
                      <span className="admin-btn-spinner" aria-hidden="true" />
                    )}
                    <span>{loadingMore ? "正在加载更多…" : "加载更多"}</span>
                  </button>

                  {loadMoreError && (
                    <div
                      className="admin-load-more-error"
                      role="alert"
                      aria-live="polite"
                    >
                      <AlertCircleIcon size={14} />
                      <span>{loadMoreError}</span>
                      <button
                        type="button"
                        className="admin-load-more-retry-btn"
                        onClick={handleLoadMore}
                      >
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
