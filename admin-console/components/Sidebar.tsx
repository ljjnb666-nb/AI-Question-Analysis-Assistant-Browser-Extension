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
  closeButtonRef?: React.RefObject<HTMLButtonElement>;
}

export function Sidebar({
  currentPath,
  isMobileOpen = false,
  onCloseMobile,
  closeButtonRef,
}: SidebarProps): React.JSX.Element {
  const handleKeyDown = (e: React.KeyboardEvent<HTMLElement>) => {
    if (!isMobileOpen) return;
    if (e.key === "Tab") {
      const aside = e.currentTarget;
      const focusables = aside.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];

      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };

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
        id="admin-navigation-drawer"
        className={`admin-sidebar ${isMobileOpen ? "is-mobile-open" : ""}`}
        aria-label="管理后台导航"
        onKeyDown={handleKeyDown}
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
              ref={closeButtonRef}
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
