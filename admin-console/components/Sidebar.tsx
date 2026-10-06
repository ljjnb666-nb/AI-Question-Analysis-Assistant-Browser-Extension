import React from "react";
import {
  OverviewIcon,
  AnalyticsIcon,
  UsersIcon,
  SystemIcon,
  AuditIcon,
  LogoutIcon,
  CloseIcon,
} from "./Icons";

export interface NavItem {
  href: string;
  label: string;
  icon: (props: { className?: string; size?: number }) => React.JSX.Element;
}

export const NAV_ITEMS: NavItem[] = [
  { href: "/admin", label: "概览", icon: OverviewIcon },
  { href: "/admin/analytics", label: "分析", icon: AnalyticsIcon },
  { href: "/admin/users", label: "用户", icon: UsersIcon },
  { href: "/admin/system", label: "系统", icon: SystemIcon },
  { href: "/admin/audit", label: "审计", icon: AuditIcon },
];

interface SidebarProps {
  currentPath: string;
  isMobileOpen?: boolean;
  onCloseMobile?: () => void;
}

export function Sidebar({
  currentPath,
  isMobileOpen = false,
  onCloseMobile,
}: SidebarProps): React.JSX.Element {
  return (
    <>
      {isMobileOpen && (
        <div
          className="admin-sidebar-backdrop"
          onClick={onCloseMobile}
          aria-hidden="true"
        />
      )}
      <aside
        className={`admin-sidebar ${isMobileOpen ? "is-mobile-open" : ""}`}
        aria-label="管理后台导航"
      >
        <div className="admin-sidebar-header">
          <div className="admin-brand">
            <div className="admin-brand-icon" aria-hidden="true">
              QS
            </div>
            <div className="admin-brand-text">
              <strong className="admin-brand-title">Quiz Solver</strong>
              <span className="admin-brand-subtitle">管理后台</span>
            </div>
          </div>
          {isMobileOpen && onCloseMobile && (
            <button
              type="button"
              className="admin-mobile-close-btn"
              onClick={onCloseMobile}
              aria-label="关闭导航抽屉"
            >
              <CloseIcon size={20} />
            </button>
          )}
        </div>

        <nav className="admin-nav" aria-label="主要导航">
          <ul className="admin-nav-list">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const isCurrent = currentPath === item.href;
              return (
                <li key={item.href} className="admin-nav-item">
                  <a
                    href={item.href}
                    className={`admin-nav-link ${isCurrent ? "is-active" : ""}`}
                    aria-current={isCurrent ? "page" : undefined}
                    onClick={() => {
                      if (onCloseMobile) onCloseMobile();
                    }}
                  >
                    <Icon size={18} className="admin-nav-icon" />
                    <span>{item.label}</span>
                  </a>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="admin-sidebar-footer">
          <form
            method="POST"
            action="/admin/logout"
            className="admin-logout-form"
          >
            <button type="submit" className="admin-logout-btn">
              <LogoutIcon size={18} className="admin-logout-icon" />
              <span>退出登录</span>
            </button>
          </form>
        </div>
      </aside>
    </>
  );
}
