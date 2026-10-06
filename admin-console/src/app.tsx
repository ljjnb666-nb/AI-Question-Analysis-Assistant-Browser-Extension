import { useCallback, useEffect, useState } from "react";
import { fetchAdminSession, type AdminSessionState } from "./session";
import { navigateTo, useAdminPath } from "./router";

const SECTIONS = [
  { path: "/admin", label: "总览" },
  { path: "/admin/analytics", label: "统计" },
  { path: "/admin/users", label: "用户" },
  { path: "/admin/system", label: "系统" },
  { path: "/admin/audit", label: "审计" },
] as const;

function sectionTitle(path: string): string {
  const match = SECTIONS.find((section) => section.path === path);
  return match ? match.label : "总览";
}

function NavLinks({ currentPath }: { currentPath: string }) {
  return (
    <nav aria-label="Admin sections">
      <ul className="admin-nav-list">
        {SECTIONS.map((section) => {
          const active = section.path === currentPath;
          return (
            <li key={section.path}>
              <a
                href={section.path}
                aria-current={active ? "page" : undefined}
                onClick={(event) => {
                  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                  event.preventDefault();
                  navigateTo(section.path);
                }}
              >
                {section.label}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function SessionCheckNotice() {
  return (
    <main className="admin-main">
      <p role="status">正在验证管理员会话…</p>
    </main>
  );
}

function ServiceUnavailableNotice({ onRetry }: { onRetry: () => void }) {
  return (
    <main className="admin-main">
      <section aria-labelledby="admin-session-error">
        <h2 id="admin-session-error">无法确认管理员会话</h2>
        <p>会话服务暂时不可用，请稍后重试。</p>
        <button type="button" onClick={onRetry}>
          重试
        </button>
      </section>
    </main>
  );
}

export function AdminApp() {
  const currentPath = useAdminPath();
  const [session, setSession] = useState<AdminSessionState>({ kind: "checking" });

  const checkSession = useCallback(() => {
    setSession({ kind: "checking" });
    void fetchAdminSession().then((state) => {
      if (state.kind === "unauthorized") {
        // Authoritative session loss: never keep rendering protected state.
        window.location.replace("/admin/login");
        return;
      }
      setSession(state);
    });
  }, []);

  useEffect(checkSession, [checkSession]);

  if (session.kind === "checking") {
    return <SessionCheckNotice />;
  }

  if (session.kind === "unauthorized") {
    return <SessionCheckNotice />;
  }

  if (session.kind === "unavailable") {
    return <ServiceUnavailableNotice onRetry={checkSession} />;
  }

  const expiresAt = new Date(session.expiresAt);

  return (
    <div className="admin-shell">
      <header className="admin-sidebar">
        <p className="admin-brand">Quiz Solver Admin</p>
        <NavLinks currentPath={currentPath} />
        <form method="POST" action="/admin/logout">
          <button type="submit">退出登录</button>
        </form>
      </header>
      <main className="admin-main">
        <h1>{sectionTitle(currentPath)}</h1>
        <p>本阶段未实现（Not implemented in this phase）。</p>
        <p className="admin-meta">会话有效期至 {expiresAt.toLocaleString()}</p>
      </main>
    </div>
  );
}
