import React from "react";
import { MenuIcon } from "./Icons";
import { SessionStatus } from "./SessionStatus";

interface PageHeaderProps {
  title: string;
  description: string;
  expiresAt: string | null;
  onToggleMobile?: () => void;
  isMobileOpen?: boolean;
  triggerRef?: React.RefObject<HTMLButtonElement>;
}

export function PageHeader({
  title,
  description,
  expiresAt,
  onToggleMobile,
  isMobileOpen = false,
  triggerRef,
}: PageHeaderProps): React.JSX.Element {
  return (
    <header className="admin-page-header">
      <div className="admin-header-top">
        <div className="admin-header-left">
          {onToggleMobile && (
            <button
              ref={triggerRef}
              type="button"
              className="admin-mobile-menu-btn"
              onClick={onToggleMobile}
              aria-label={isMobileOpen ? "关闭导航菜单" : "打开导航菜单"}
              aria-expanded={isMobileOpen}
              aria-controls="admin-navigation-drawer"
            >
              <MenuIcon size={20} />
            </button>
          )}
          <nav className="admin-breadcrumb" aria-label="页面层级">
            <span className="admin-breadcrumb-root">独立管理后台</span>
            <span className="admin-breadcrumb-separator" aria-hidden="true">
              /
            </span>
            <span className="admin-breadcrumb-current">{title}</span>
          </nav>
        </div>
        <div className="admin-header-right">
          <SessionStatus expiresAt={expiresAt} />
        </div>
      </div>
      <div className="admin-header-main">
        <h1 className="admin-page-title">{title}</h1>
        <p className="admin-page-desc">{description}</p>
      </div>
    </header>
  );
}
