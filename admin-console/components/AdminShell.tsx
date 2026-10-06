import React, { useState, useEffect, useCallback } from "react";
import { Sidebar } from "./Sidebar";
import { PageHeader } from "./PageHeader";
import {
  MetricPlaceholderCard,
  EmptyStateNotice,
  PlaceholderSection,
  TablePlaceholder,
} from "./EmptyState";

interface AdminShellProps {
  currentPath: string;
  expiresAt: string | null;
}

interface PageMeta {
  title: string;
  description: string;
}

const PAGE_REGISTRY: Record<string, PageMeta> = {
  "/admin": {
    title: "概览",
    description: "查看 Quiz Solver 管理后台的核心运行信息。",
  },
  "/admin/analytics": {
    title: "分析",
    description: "查看匿名、已授权统计数据和解析运行趋势。",
  },
  "/admin/users": {
    title: "用户",
    description: "查看已注册用户和账号关联设备。",
  },
  "/admin/system": {
    title: "系统",
    description: "查看后台服务和存储运行状态。",
  },
  "/admin/audit": {
    title: "审计",
    description: "查看管理后台的安全与操作审计记录。",
  },
};

export function AdminShell({
  currentPath,
  expiresAt,
}: AdminShellProps): React.JSX.Element {
  const [isMobileOpen, setIsMobileOpen] = useState(false);

  const toggleMobile = useCallback(() => {
    setIsMobileOpen((prev) => !prev);
  }, []);

  const closeMobile = useCallback(() => {
    setIsMobileOpen(false);
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isMobileOpen) {
        closeMobile();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isMobileOpen, closeMobile]);

  const pageMeta = PAGE_REGISTRY[currentPath] ?? {
    title: "管理后台",
    description: "当前请求的管理后台路径不存在或已迁移。",
  };

  const renderContent = () => {
    switch (currentPath) {
      case "/admin":
        return (
          <>
            <EmptyStateNotice
              title="概览数据尚未接入"
              description="管理后台基础设施已经就绪。核心指标将在数据模型接入后展示。"
            />
            <section className="admin-grid-metrics" aria-label="核心指标占位">
              <MetricPlaceholderCard label="活跃设备" />
              <MetricPlaceholderCard label="解析请求数" />
              <MetricPlaceholderCard label="解析成功率" />
              <MetricPlaceholderCard label="平均响应时延" />
            </section>
            <div className="admin-grid-sections">
              <PlaceholderSection
                title="使用情况概览"
                subtitle="展示设备活跃度与调用频次统计"
              />
              <PlaceholderSection
                title="版本分布"
                subtitle="展示扩展与客户端版本分布比例"
              />
            </div>
          </>
        );

      case "/admin/analytics":
        return (
          <>
            <EmptyStateNotice
              title="分析数据尚未接入"
              description="趋势、解析结果、提供商分布、错误分类及版本分布指标将在分析模型接入后展示。"
            />
            <section className="admin-grid-metrics" aria-label="分析指标占位">
              <MetricPlaceholderCard label="总解析量" />
              <MetricPlaceholderCard label="模型调用分布" />
              <MetricPlaceholderCard label="错误分类分布" />
              <MetricPlaceholderCard label="活跃版本数" />
            </section>
            <div className="admin-grid-sections">
              <PlaceholderSection
                title="解析请求趋势"
                subtitle="展示匿名、已授权的时间序列统计"
              />
              <PlaceholderSection
                title="提供商与模型占比"
                subtitle="展示各 AI 服务商调用分布情况"
              />
            </div>
          </>
        );

      case "/admin/users":
        return (
          <>
            <EmptyStateNotice
              title="用户数据尚未接入"
              description="用户管理与设备关联列表将在用户管理模块接入后展示。"
            />
            <section className="admin-grid-metrics" aria-label="用户指标占位">
              <MetricPlaceholderCard label="注册用户总数" />
              <MetricPlaceholderCard label="关联设备总数" />
            </section>
            <PlaceholderSection
              title="已注册用户与设备"
              subtitle="展示用户身份及绑定的扩展设备凭证状态"
            >
              <TablePlaceholder
                headers={["用户标识", "注册时间", "关联设备数", "状态"]}
                emptyMessage="暂无用户数据 · 等待接入"
              />
            </PlaceholderSection>
          </>
        );

      case "/admin/system":
        return (
          <>
            <EmptyStateNotice
              title="系统状态数据尚未接入"
              description="后台服务与存储运行健康指标将在系统监控接入后展示。"
            />
            <section className="admin-grid-metrics" aria-label="系统指标占位">
              <MetricPlaceholderCard
                label="分析服务状态"
                statusText="等待监控接入"
              />
              <MetricPlaceholderCard
                label="存储数据库"
                statusText="等待监控接入"
              />
              <MetricPlaceholderCard
                label="认证网关"
                statusText="等待监控接入"
              />
            </section>
            <div className="admin-grid-sections">
              <PlaceholderSection
                title="服务运行健康"
                subtitle="展示后台服务进程与端口可用性"
              />
              <PlaceholderSection
                title="存储与队列"
                subtitle="展示持久化存储与后台任务执行状态"
              />
            </div>
          </>
        );

      case "/admin/audit":
        return (
          <>
            <EmptyStateNotice
              title="审计记录尚未接入"
              description="管理后台的安全与操作审计流水将在审计模块接入后展示。"
            />
            <section className="admin-grid-metrics" aria-label="审计指标占位">
              <MetricPlaceholderCard
                label="安全审计事件"
                statusText="等待审计接入"
              />
              <MetricPlaceholderCard
                label="敏感操作记录"
                statusText="等待审计接入"
              />
            </section>
            <PlaceholderSection
              title="安全与操作审计流水"
              subtitle="展示会话变更、登录记录及管理配置审计"
            >
              <TablePlaceholder
                headers={[
                  "记录时间",
                  "操作类型",
                  "操作主体",
                  "目标对象",
                  "操作结果",
                ]}
                emptyMessage="暂无审计记录 · 等待接入"
              />
            </PlaceholderSection>
          </>
        );

      default:
        return (
          <EmptyStateNotice
            title="页面不存在"
            description="当前请求的后台路由未定义，请从左侧导航栏选择有效功能。"
          />
        );
    }
  };

  return (
    <div className="admin-layout">
      <Sidebar
        currentPath={currentPath}
        isMobileOpen={isMobileOpen}
        onCloseMobile={closeMobile}
      />
      <div className="admin-main-wrapper">
        <PageHeader
          title={pageMeta.title}
          description={pageMeta.description}
          expiresAt={expiresAt}
          onToggleMobile={toggleMobile}
          isMobileOpen={isMobileOpen}
        />
        <main className="admin-main-content">
          <div className="admin-content-inner">{renderContent()}</div>
        </main>
        <footer className="admin-footer">
          <p className="admin-footer-text">
            Quiz Solver 管理后台 · 安全受控环境
          </p>
        </footer>
      </div>
    </div>
  );
}
