import React, { useCallback, useEffect, useRef, useState } from "react";
import type {
  AdminAnalyticsDays,
  AdminErrorsResponse,
  AdminLatencyResponse,
  AdminProvidersResponse,
  AdminTimeseriesResponse,
  AdminVersionsResponse,
} from "../../types/adminAnalytics";
import {
  fetchAdminErrors,
  fetchAdminLatency,
  fetchAdminProviders,
  fetchAdminTimeseries,
  fetchAdminVersions,
} from "../../lib/adminAnalyticsApi";
import {
  getAdminErrorMessage,
  getLatestGeneratedAt,
} from "../../lib/adminAnalyticsFormat";
import { AnalyticsToolbar } from "./AnalyticsToolbar";
import { ParseOutcomesTrend, ActivityTrend } from "./TrendChart";
import { ProviderBreakdown } from "./ProviderBreakdown";
import { ErrorBreakdown } from "./ErrorBreakdown";
import { VersionBreakdown } from "./VersionBreakdown";
import { LatencyChart } from "./LatencyChart";
import { SectionState } from "./SectionState";
import { InfoIcon } from "../Icons";

type EndpointKey = "timeseries" | "providers" | "errors" | "versions" | "latency";

export function AnalyticsView(): React.JSX.Element {
  const [days, setDays] = useState<AdminAnalyticsDays>(14);

  // Independent state per section for partial failure resilience
  const [timeseries, setTimeseries] = useState<AdminTimeseriesResponse | null>(null);
  const [timeseriesLoading, setTimeseriesLoading] = useState(true);
  const [timeseriesError, setTimeseriesError] = useState<string | null>(null);

  const [providers, setProviders] = useState<AdminProvidersResponse | null>(null);
  const [providersLoading, setProvidersLoading] = useState(true);
  const [providersError, setProvidersError] = useState<string | null>(null);

  const [errorsData, setErrorsData] = useState<AdminErrorsResponse | null>(null);
  const [errorsLoading, setErrorsLoading] = useState(true);
  const [errorsError, setErrorsError] = useState<string | null>(null);

  const [versions, setVersions] = useState<AdminVersionsResponse | null>(null);
  const [versionsLoading, setVersionsLoading] = useState(true);
  const [versionsError, setVersionsError] = useState<string | null>(null);

  const [latency, setLatency] = useState<AdminLatencyResponse | null>(null);
  const [latencyLoading, setLatencyLoading] = useState(true);
  const [latencyError, setLatencyError] = useState<string | null>(null);

  const abortControllersRef = useRef<Partial<Record<EndpointKey, AbortController>>>({});

  // 1. Scoped Timeseries loader
  const loadTimeseries = useCallback((targetDays: AdminAnalyticsDays) => {
    abortControllersRef.current.timeseries?.abort();
    const controller = new AbortController();
    abortControllersRef.current.timeseries = controller;
    const signal = controller.signal;

    setTimeseriesLoading(true);
    setTimeseriesError(null);

    fetchAdminTimeseries(targetDays, signal)
      .then((res) => {
        if (signal.aborted) return;
        setTimeseries(res);
        setTimeseriesLoading(false);
      })
      .catch((err: unknown) => {
        if (signal.aborted) return;
        setTimeseriesError(getAdminErrorMessage(err));
        setTimeseriesLoading(false);
      });
  }, []);

  // 2. Scoped Providers loader
  const loadProviders = useCallback((targetDays: AdminAnalyticsDays) => {
    abortControllersRef.current.providers?.abort();
    const controller = new AbortController();
    abortControllersRef.current.providers = controller;
    const signal = controller.signal;

    setProvidersLoading(true);
    setProvidersError(null);

    fetchAdminProviders(targetDays, signal)
      .then((res) => {
        if (signal.aborted) return;
        setProviders(res);
        setProvidersLoading(false);
      })
      .catch((err: unknown) => {
        if (signal.aborted) return;
        setProvidersError(getAdminErrorMessage(err));
        setProvidersLoading(false);
      });
  }, []);

  // 3. Scoped Errors loader
  const loadErrors = useCallback((targetDays: AdminAnalyticsDays) => {
    abortControllersRef.current.errors?.abort();
    const controller = new AbortController();
    abortControllersRef.current.errors = controller;
    const signal = controller.signal;

    setErrorsLoading(true);
    setErrorsError(null);

    fetchAdminErrors(targetDays, signal)
      .then((res) => {
        if (signal.aborted) return;
        setErrorsData(res);
        setErrorsLoading(false);
      })
      .catch((err: unknown) => {
        if (signal.aborted) return;
        setErrorsError(getAdminErrorMessage(err));
        setErrorsLoading(false);
      });
  }, []);

  // 4. Scoped Versions loader
  const loadVersions = useCallback((targetDays: AdminAnalyticsDays) => {
    abortControllersRef.current.versions?.abort();
    const controller = new AbortController();
    abortControllersRef.current.versions = controller;
    const signal = controller.signal;

    setVersionsLoading(true);
    setVersionsError(null);

    fetchAdminVersions(targetDays, signal)
      .then((res) => {
        if (signal.aborted) return;
        setVersions(res);
        setVersionsLoading(false);
      })
      .catch((err: unknown) => {
        if (signal.aborted) return;
        setVersionsError(getAdminErrorMessage(err));
        setVersionsLoading(false);
      });
  }, []);

  // 5. Scoped Latency loader
  const loadLatency = useCallback((targetDays: AdminAnalyticsDays) => {
    abortControllersRef.current.latency?.abort();
    const controller = new AbortController();
    abortControllersRef.current.latency = controller;
    const signal = controller.signal;

    setLatencyLoading(true);
    setLatencyError(null);

    fetchAdminLatency(targetDays, signal)
      .then((res) => {
        if (signal.aborted) return;
        setLatency(res);
        setLatencyLoading(false);
      })
      .catch((err: unknown) => {
        if (signal.aborted) return;
        setLatencyError(getAdminErrorMessage(err));
        setLatencyLoading(false);
      });
  }, []);

  const loadAll = useCallback(
    (targetDays: AdminAnalyticsDays) => {
      loadTimeseries(targetDays);
      loadProviders(targetDays);
      loadErrors(targetDays);
      loadVersions(targetDays);
      loadLatency(targetDays);
    },
    [loadTimeseries, loadProviders, loadErrors, loadVersions, loadLatency],
  );

  useEffect(() => {
    loadAll(days);
    const controllers = abortControllersRef.current;
    return () => {
      controllers.timeseries?.abort();
      controllers.providers?.abort();
      controllers.errors?.abort();
      controllers.versions?.abort();
      controllers.latency?.abort();
    };
  }, [days, loadAll]);

  // Window-matching responses only (prevents rendering stale window data under new window label)
  const currentTimeseries = timeseries?.window?.days === days ? timeseries : null;
  const currentProviders = providers?.window?.days === days ? providers : null;
  const currentErrors = errorsData?.window?.days === days ? errorsData : null;
  const currentVersions = versions?.window?.days === days ? versions : null;
  const currentLatency = latency?.window?.days === days ? latency : null;

  const isAnyLoading =
    timeseriesLoading ||
    providersLoading ||
    errorsLoading ||
    versionsLoading ||
    latencyLoading;

  // Pick latest generatedAt from currently valid responses
  const generatedAt = getLatestGeneratedAt([
    currentTimeseries?.generatedAt,
    currentProviders?.generatedAt,
    currentErrors?.generatedAt,
    currentVersions?.generatedAt,
    currentLatency?.generatedAt,
  ]);

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
          days={days}
          onDaysChange={(newDays) => setDays(newDays)}
          onRefresh={() => loadAll(days)}
          loading={isAnyLoading}
          generatedAt={generatedAt}
          label="分析周期"
        />
      </div>

      {/* Section 1: Parse Outcomes Trend */}
      <section className="admin-section-card" aria-label="解析结果趋势">
        <div className="admin-section-header">
          <h2 className="admin-section-title">解析结果趋势</h2>
          <span className="admin-section-subtitle">
            最近 {days} 日观测到的成功与失败解析结果时间序列分布
          </span>
        </div>
        <div className="admin-section-body">
          <SectionState
            loading={timeseriesLoading || (!currentTimeseries && !timeseriesError)}
            error={timeseriesError}
            empty={Boolean(currentTimeseries && currentTimeseries.data.length === 0)}
            emptyMessage="当前时间范围内暂无解析结果趋势数据"
            onRetry={() => loadTimeseries(days)}
          >
            {currentTimeseries && <ParseOutcomesTrend data={currentTimeseries.data} />}
          </SectionState>
        </div>
      </section>

      {/* Section 2: Activity Trend */}
      <section className="admin-section-card" aria-label="已授权活跃设备趋势">
        <div className="admin-section-header">
          <h2 className="admin-section-title">已授权活跃设备与注册趋势</h2>
          <span className="admin-section-subtitle">
            最近 {days} 日已授权日活跃设备 (optInDau) 与全量新注册账号趋势
          </span>
        </div>
        <div className="admin-section-body">
          <SectionState
            loading={timeseriesLoading || (!currentTimeseries && !timeseriesError)}
            error={timeseriesError}
            empty={Boolean(currentTimeseries && currentTimeseries.data.length === 0)}
            emptyMessage="当前时间范围内暂无活跃设备数据"
            onRetry={() => loadTimeseries(days)}
          >
            {currentTimeseries && <ActivityTrend data={currentTimeseries.data} />}
          </SectionState>
        </div>
      </section>

      {/* Section 3: Providers & Errors Grid */}
      <div className="admin-grid-sections">
        <section className="admin-section-card" aria-label="解析结果提供商分布">
          <div className="admin-section-header">
            <h2 className="admin-section-title">解析结果提供商分布</h2>
            <span className="admin-section-subtitle">
              展示各模型提供商观测到的解析结果与成功率分布
            </span>
          </div>
          <div className="admin-section-body">
            <SectionState
              loading={providersLoading || (!currentProviders && !providersError)}
              error={providersError}
              empty={Boolean(currentProviders && currentProviders.data.length === 0)}
              emptyMessage="当前时间范围内暂无解析结果提供商数据"
              onRetry={() => loadProviders(days)}
            >
              {currentProviders && <ProviderBreakdown data={currentProviders.data} />}
            </SectionState>
          </div>
        </section>

        <section className="admin-section-card" aria-label="解析错误分类">
          <div className="admin-section-header">
            <h2 className="admin-section-title">解析错误分类</h2>
            <span className="admin-section-subtitle">
              展示观测到的解析错误类型分类及终止重试次数统计
            </span>
          </div>
          <div className="admin-section-body">
            <SectionState
              loading={errorsLoading || (!currentErrors && !errorsError)}
              error={errorsError}
              empty={Boolean(currentErrors && currentErrors.data.length === 0)}
              emptyMessage="当前时间范围内暂无解析错误数据"
              onRetry={() => loadErrors(days)}
            >
              {currentErrors && <ErrorBreakdown data={currentErrors.data} />}
            </SectionState>
          </div>
        </section>
      </div>

      {/* Section 4: Versions & Latency Grid */}
      <div className="admin-grid-sections">
        <section className="admin-section-card" aria-label="最新观测扩展版本分布">
          <div className="admin-section-header">
            <h2 className="admin-section-title">最新观测扩展版本分布</h2>
            <span className="admin-section-subtitle">
              请求窗口内每台已授权设备的最新观测扩展版本
            </span>
          </div>
          <div className="admin-section-body">
            <SectionState
              loading={versionsLoading || (!currentVersions && !versionsError)}
              error={versionsError}
              empty={Boolean(currentVersions && currentVersions.data.length === 0)}
              emptyMessage="当前时间范围内暂无版本数据"
              onRetry={() => loadVersions(days)}
            >
              {currentVersions && <VersionBreakdown data={currentVersions.data} />}
            </SectionState>
          </div>
        </section>

        <section className="admin-section-card" aria-label="观测解析耗时趋势">
          <div className="admin-section-header">
            <h2 className="admin-section-title">观测解析耗时趋势</h2>
            <span className="admin-section-subtitle">
              最近 {days} 日解析结果事件观测到的平均耗时分布 (ms)
            </span>
          </div>
          <div className="admin-section-body">
            <SectionState
              loading={latencyLoading || (!currentLatency && !latencyError)}
              error={latencyError}
              empty={Boolean(currentLatency && currentLatency.data.length === 0)}
              emptyMessage="当前时间范围内暂无耗时数据"
              onRetry={() => loadLatency(days)}
            >
              {currentLatency && <LatencyChart data={currentLatency.data} />}
            </SectionState>
          </div>
        </section>
      </div>
    </div>
  );
}
