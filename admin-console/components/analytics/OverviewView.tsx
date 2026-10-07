import React, { useCallback, useEffect, useRef, useState } from "react";
import type { AdminOverviewResponse } from "../../types/adminAnalytics";
import { fetchAdminOverview } from "../../lib/adminAnalyticsApi";
import {
  formatDuration,
  formatNumber,
  formatPercent,
  getAdminErrorMessage,
} from "../../lib/adminAnalyticsFormat";
import { MetricCard } from "./MetricCard";
import { SectionState } from "./SectionState";
import { AnalyticsToolbar } from "./AnalyticsToolbar";
import { InfoIcon } from "../Icons";

export function OverviewView(): React.JSX.Element {
  const [data, setData] = useState<AdminOverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const loadData = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setLoading(true);
    setError(null);

    fetchAdminOverview(14, controller.signal)
      .then((res) => {
        if (controller.signal.aborted) return;
        setData(res);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setError(getAdminErrorMessage(err));
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    loadData();
    return () => {
      abortControllerRef.current?.abort();
    };
  }, [loadData]);

  const activity = data?.activity;
  const accounts = data?.accounts;
  const observed = data?.observed;
  const parseOutcomes = observed?.parseOutcomesToday;
  const latency = observed?.parseOutcomeLatencyWindowMs;

  return (
    <div className="admin-view-container">
      {/* Scope Disclosure Alert */}
      <div className="admin-scope-banner" role="note">
        <div className="admin-scope-icon-wrap" aria-hidden="true">
          <InfoIcon size={18} />
        </div>
        <p className="admin-scope-text">
          活动与解析指标仅基于已授权匿名统计数据；注册用户指标来自全部已注册账号。统计日期按 UTC 聚合。
        </p>
      </div>

      {/* Control bar */}
      <div className="admin-view-header-bar">
        <AnalyticsToolbar
          days={14}
          onDaysChange={() => {}}
          onRefresh={loadData}
          loading={loading}
          generatedAt={data?.generatedAt}
          label="概览窗口"
        />
      </div>

      <SectionState
        loading={loading && !data}
        error={error}
        onRetry={loadData}
      >
        {/* Top KPI row */}
        <section className="admin-grid-metrics" aria-label="核心活跃与用户指标">
          <MetricCard
            label="今日已授权活跃设备"
            value={formatNumber(activity?.dau)}
            badge="今日 (DAU)"
            hint="授权匿名设备"
            loading={loading}
          />
          <MetricCard
            label="7 日已授权活跃设备"
            value={formatNumber(activity?.wau)}
            badge="7 日 (WAU)"
            hint="授权匿名设备"
            loading={loading}
          />
          <MetricCard
            label="30 日已授权活跃设备"
            value={formatNumber(activity?.mau)}
            badge="30 日 (MAU)"
            hint="授权匿名设备"
            loading={loading}
          />
          <MetricCard
            label="注册用户总数"
            value={formatNumber(accounts?.registeredUsers)}
            badge="全量账号"
            hint="全部已注册用户"
            loading={loading}
          />
        </section>

        {/* Second KPI row */}
        <section className="admin-grid-metrics" aria-label="今日新增与运行指标">
          <MetricCard
            label="今日新注册"
            value={formatNumber(accounts?.registrationsToday)}
            badge="今日新增"
            hint="全量注册用户"
            loading={loading}
          />
          <MetricCard
            label="今日观测安装设备"
            value={formatNumber(observed?.installDevicesToday)}
            badge="今日观测"
            hint="授权安装事件设备"
            loading={loading}
          />
          <MetricCard
            label="今日产生解析结果的设备"
            value={formatNumber(observed?.parseOutcomeDevicesToday)}
            badge="今日观测"
            hint="产生解析成功/失败的设备"
            loading={loading}
          />
          <MetricCard
            label="今日解析结果数"
            value={formatNumber(parseOutcomes?.total)}
            badge={
              parseOutcomes
                ? `成功 ${parseOutcomes.success} · 失败 ${parseOutcomes.error}`
                : undefined
            }
            hint="今日观测解析结果总计"
            loading={loading}
          />
        </section>

        {/* Detailed KPI summary sections */}
        <div className="admin-grid-sections">
          <div className="admin-section-card">
            <div className="admin-section-header">
              <h2 className="admin-section-title">今日观测解析结果成功率</h2>
              <span className="admin-section-subtitle">
                基于今日观测到的全部解析成功与失败结果统计
              </span>
            </div>
            <div className="admin-section-body admin-overview-card-body">
              <div className="admin-hero-metric-wrap">
                <span className="admin-hero-metric-value">
                  {formatPercent(parseOutcomes?.successRatio, "暂无样本")}
                </span>
                <span className="admin-hero-metric-badge">
                  {parseOutcomes && parseOutcomes.total > 0
                    ? `成功率 · 共 ${formatNumber(parseOutcomes.total)} 结果`
                    : "暂无样本"}
                </span>
              </div>
              <div className="admin-hero-metric-details">
                <div className="admin-hero-detail-item">
                  <span className="admin-detail-label">成功解析结果</span>
                  <strong className="admin-detail-value admin-color-success">
                    {formatNumber(parseOutcomes?.success)}
                  </strong>
                </div>
                <div className="admin-hero-detail-item">
                  <span className="admin-detail-label">失败解析结果</span>
                  <strong className="admin-detail-value admin-color-danger">
                    {formatNumber(parseOutcomes?.error)}
                  </strong>
                </div>
              </div>
            </div>
          </div>

          <div className="admin-section-card">
            <div className="admin-section-header">
              <h2 className="admin-section-title">平均观测解析耗时</h2>
              <span className="admin-section-subtitle">
                最近 14 日窗口内观测到的解析耗时统计
              </span>
            </div>
            <div className="admin-section-body admin-overview-card-body">
              <div className="admin-hero-metric-wrap">
                <span className="admin-hero-metric-value">
                  {formatDuration(latency?.average, "暂无样本")}
                </span>
                <span className="admin-hero-metric-badge">
                  {latency && latency.samples > 0
                    ? `观测样本数 ${formatNumber(latency.samples)}`
                    : "暂无样本"}
                </span>
              </div>
              <div className="admin-hero-metric-details">
                <div className="admin-hero-detail-item">
                  <span className="admin-detail-label">观测样本数</span>
                  <strong className="admin-detail-value">
                    {formatNumber(latency?.samples)}
                  </strong>
                </div>
                <div className="admin-hero-detail-item">
                  <span className="admin-detail-label">耗时统计口径</span>
                  <span className="admin-detail-desc">仅含解析成功与失败结果</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </SectionState>
    </div>
  );
}
