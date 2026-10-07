import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  RefreshIcon,
  AlertCircleIcon,
  ServerIcon,
  ShieldCheckIcon,
  HardDriveIcon,
  MailIcon,
  ActivityIcon,
  ClockIcon,
} from "../Icons";
import { fetchAdminSystem } from "../../lib/adminManagementApi";
import {
  formatAdminDateTime,
  formatUptimeDuration,
  getSystemErrorMessage,
} from "../../lib/adminManagementFormat";
import type { AdminSystemResponse } from "../../types/adminManagement";

export function SystemView(): React.JSX.Element {
  const [data, setData] = useState<AdminSystemResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);

  const loadSystemData = useCallback(() => {
    abortControllerRef.current?.abort();

    const controller = new AbortController();
    abortControllerRef.current = controller;
    const signal = controller.signal;

    setLoading(true);
    setError(null);

    fetchAdminSystem(signal)
      .then((res) => {
        if (signal.aborted) return;
        setData(res);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (signal.aborted) return;
        setError(getSystemErrorMessage(err));
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    loadSystemData();
    return () => {
      abortControllerRef.current?.abort();
    };
  }, [loadSystemData]);

  return (
    <div className="admin-view-container">
      {/* Header Toolbar */}
      <div className="admin-toolbar">
        <div className="admin-toolbar-left">
          <div className="admin-toolbar-icon" aria-hidden="true">
            <ServerIcon size={16} />
          </div>
          <span className="admin-toolbar-label">系统状态快照</span>
        </div>

        <div className="admin-toolbar-right">
          {data?.generatedAt && (
            <span className="admin-toolbar-timestamp">
              数据生成时间: {formatAdminDateTime(data.generatedAt)}
            </span>
          )}
          <button
            type="button"
            className="admin-refresh-btn"
            onClick={loadSystemData}
            disabled={loading}
            aria-label="刷新系统状态"
          >
            <RefreshIcon
              size={14}
              className={loading ? "admin-spin-icon" : ""}
            />
            <span>刷新</span>
          </button>
        </div>
      </div>

      {/* 1. Loading State */}
      {loading && !data && (
        <div className="admin-section-state-box" aria-busy="true">
          <div className="admin-spinner" aria-hidden="true" />
          <span className="admin-section-loading-text">正在加载系统状态…</span>
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
            onClick={loadSystemData}
          >
            <RefreshIcon size={14} />
            <span>重新加载</span>
          </button>
        </div>
      )}

      {/* 3. Loaded System View */}
      {data && (
        <div className="admin-system-content">
          {/* Section 1: 运行状态 */}
          <section className="admin-section-card" aria-label="运行状态">
            <div className="admin-section-header">
              <h2 className="admin-section-title">运行状态</h2>
              <span className="admin-section-subtitle">
                当前后台服务进程与运行时长状态
              </span>
            </div>

            <div className="admin-system-card-grid">
              <div className="admin-status-item-card">
                <div className="admin-status-card-header">
                  <div className="admin-status-card-icon" aria-hidden="true">
                    <ActivityIcon size={18} />
                  </div>
                  <span className="admin-status-card-label">当前服务</span>
                  <span className="admin-status-badge is-ok">
                    {data.service.status === "ok" ? "正常" : data.service.status}
                  </span>
                </div>
                <p className="admin-status-card-desc">
                  表示当前后台进程能够成功处理此状态请求。
                </p>
              </div>

              <div className="admin-status-item-card">
                <div className="admin-status-card-header">
                  <div className="admin-status-card-icon" aria-hidden="true">
                    <ClockIcon size={18} />
                  </div>
                  <span className="admin-status-card-label">当前进程运行时长</span>
                  <span className="admin-status-card-value">
                    {formatUptimeDuration(data.service.uptimeSeconds)}
                  </span>
                </div>
                <p className="admin-status-card-desc">
                  当前后台 Node 进程的持续运行时间。
                </p>
              </div>

              <div className="admin-status-item-card">
                <div className="admin-status-card-header">
                  <div className="admin-status-card-icon" aria-hidden="true">
                    <ServerIcon size={18} />
                  </div>
                  <span className="admin-status-card-label">数据生成时间</span>
                  <span className="admin-status-card-value-sm">
                    {formatAdminDateTime(data.generatedAt)}
                  </span>
                </div>
                <p className="admin-status-card-desc">
                  本页系统运行快照的数据生成时间。
                </p>
              </div>
            </div>
          </section>

          {/* Section 2: 基础设施 */}
          <section className="admin-section-card" aria-label="基础设施">
            <div className="admin-section-header">
              <h2 className="admin-section-title">基础设施</h2>
              <span className="admin-section-subtitle">
                存储介质驱动、邮件集成与运行权威架构
              </span>
            </div>

            <div className="admin-system-card-grid">
              <div className="admin-status-item-card">
                <div className="admin-status-card-header">
                  <div className="admin-status-card-icon" aria-hidden="true">
                    <HardDriveIcon size={18} />
                  </div>
                  <span className="admin-status-card-label">存储驱动</span>
                  <span className="admin-status-badge is-storage">
                    {data.storage.driver === "sqlite"
                      ? "SQLite"
                      : "JSON 兼容存储"}
                  </span>
                </div>
                <p className="admin-status-card-desc">
                  {data.storage.driver === "sqlite"
                    ? "当前后台使用 SQLite 作为数据存储。"
                    : "当前运行在 JSON 兼容存储模式。"}
                </p>
              </div>

              <div className="admin-status-item-card">
                <div className="admin-status-card-header">
                  <div className="admin-status-card-icon" aria-hidden="true">
                    <MailIcon size={18} />
                  </div>
                  <span className="admin-status-card-label">邮件配置</span>
                  <span
                    className={
                      data.email.configured
                        ? "admin-status-badge is-configured"
                        : "admin-status-badge is-unconfigured"
                    }
                  >
                    {data.email.configured ? "已配置" : "未配置"}
                  </span>
                </div>
                <p className="admin-status-card-desc">
                  仅表示邮件发送配置已提供，不代表投递链路已验证。
                </p>
              </div>

              <div className="admin-status-item-card">
                <div className="admin-status-card-header">
                  <div className="admin-status-card-icon" aria-hidden="true">
                    <ShieldCheckIcon size={18} />
                  </div>
                  <span className="admin-status-card-label">运行权威</span>
                  <span className="admin-status-badge is-authority">
                    {data.deployment.authority === "single_process"
                      ? "单进程"
                      : data.deployment.authority}
                  </span>
                </div>
                <p className="admin-status-card-desc">
                  当前 Admin 会话与限流状态由单个服务进程维护。
                </p>
              </div>
            </div>
          </section>

          {/* Section 3: 分析配置 */}
          <section className="admin-section-card" aria-label="分析配置">
            <div className="admin-section-header">
              <h2 className="admin-section-title">分析配置</h2>
              <span className="admin-section-subtitle">
                匿名分析事件保留期限与统计隐私策略版本
              </span>
            </div>

            <div className="admin-system-card-grid admin-grid-2col">
              <div className="admin-status-item-card">
                <div className="admin-status-card-header">
                  <div className="admin-status-card-icon" aria-hidden="true">
                    <ClockIcon size={18} />
                  </div>
                  <span className="admin-status-card-label">分析数据保留期</span>
                  <span className="admin-status-card-value">
                    {data.analytics.retentionDays} 天
                  </span>
                </div>
                <p className="admin-status-card-desc">
                  匿名统计分析事件的最长数据保留天数。
                </p>
              </div>

              <div className="admin-status-item-card">
                <div className="admin-status-card-header">
                  <div className="admin-status-card-icon" aria-hidden="true">
                    <ShieldCheckIcon size={18} />
                  </div>
                  <span className="admin-status-card-label">隐私纪元</span>
                  <span className="admin-status-card-value">
                    {data.analytics.privacyEpoch}
                  </span>
                </div>
                <p className="admin-status-card-desc">
                  用于标识当前匿名统计隐私规则版本。
                </p>
              </div>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
