import React, { useState, useEffect, useCallback, useRef } from "react";
import { Sidebar } from "./Sidebar";
import { PageHeader } from "./PageHeader";
import { EmptyStateNotice } from "./EmptyState";
import { OverviewView } from "./analytics/OverviewView";
import { AnalyticsView } from "./analytics/AnalyticsView";
import { UsersView } from "./users/UsersView";
import { SystemView } from "./system/SystemView";
import { AuditView } from "./audit/AuditView";

interface AdminShellProps {
  currentPath: string;
  expiresAt: string | null;
  csrfToken: string;
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
    description: "查看已注册账号及其关联设备概况。",
  },
  "/admin/system": {
    title: "系统",
    description: "查看当前后台进程、存储和基础配置状态。",
  },
  "/admin/audit": {
    title: "审计",
    description: "查看管理后台的安全与操作审计记录。",
  },
};

export function AdminShell({
  currentPath,
  expiresAt,
  csrfToken,
}: AdminShellProps): React.JSX.Element {
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const wasOpenRef = useRef(false);

  const toggleMobile = useCallback(() => {
    setIsMobileOpen((prev) => !prev);
  }, []);

  const closeMobile = useCallback(() => {
    setIsMobileOpen(false);
  }, []);

  useEffect(() => {
    if (isMobileOpen) {
      wasOpenRef.current = true;
      const timer = setTimeout(() => {
        closeButtonRef.current?.focus();
      }, 0);
      return () => clearTimeout(timer);
    } else if (wasOpenRef.current) {
      wasOpenRef.current = false;
      triggerRef.current?.focus();
    }
  }, [isMobileOpen]);

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
        return <OverviewView />;

      case "/admin/analytics":
        return <AnalyticsView />;

      case "/admin/users":
        return <UsersView />;

      case "/admin/system":
        return <SystemView />;

      case "/admin/audit":
        return <AuditView />;

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
        closeButtonRef={closeButtonRef}
        csrfToken={csrfToken}
      />
      <div className="admin-main-wrapper">
        <PageHeader
          title={pageMeta.title}
          description={pageMeta.description}
          expiresAt={expiresAt}
          onToggleMobile={toggleMobile}
          isMobileOpen={isMobileOpen}
          triggerRef={triggerRef}
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
