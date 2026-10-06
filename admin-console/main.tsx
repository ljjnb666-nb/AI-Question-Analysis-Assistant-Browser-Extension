import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./admin.css";

type SessionState =
  | { status: "loading" }
  | { status: "authenticated"; expiresAt: string | null }
  | { status: "error"; message: string };

const pages = new Map([
  ["/admin", ["概览", "Overview foundation is ready. Metrics arrive in Phase 11C."]],
  ["/admin/analytics", ["分析", "Analytics read models arrive in Phase 11C."]],
  ["/admin/users", ["用户", "Read-only user administration arrives in Phase 11D."]],
  ["/admin/system", ["系统", "Sanitized system health arrives in Phase 11D."]],
  ["/admin/audit", ["审计", "Admin audit history arrives in Phase 11E."]],
]);

function normalizePath(pathname: string): string {
  const trimmed = pathname.replace(/\/+$/, "");
  return trimmed || "/admin";
}

function AdminApp() {
  const [session, setSession] = useState<SessionState>({ status: "loading" });
  const currentPath = normalizePath(window.location.pathname);
  const page = pages.get(currentPath) ?? ["管理后台", "This Admin route is not available."];

  useEffect(() => {
    const controller = new AbortController();

    void fetch("/admin/api/session", {
      method: "GET",
      cache: "no-store",
      credentials: "same-origin",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (response.status === 401) {
          window.location.replace("/admin/login");
          return null;
        }
        if (!response.ok) throw new Error("ADMIN_SESSION_CHECK_FAILED");
        return response.json() as Promise<{ ok: true; expiresAt?: string | null }>;
      })
      .then((payload) => {
        if (payload) setSession({ status: "authenticated", expiresAt: payload.expiresAt ?? null });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setSession({
          status: "error",
          message: error instanceof Error ? error.message : "ADMIN_SESSION_CHECK_FAILED",
        });
      });

    return () => controller.abort();
  }, []);

  if (session.status === "loading") {
    return <main className="auth-state" aria-live="polite">正在验证管理员会话…</main>;
  }

  if (session.status === "error") {
    return (
      <main className="auth-state" role="alert">
        管理后台暂时不可用。请刷新页面后重试。
      </main>
    );
  }

  return (
    <div className="admin-layout">
      <aside className="admin-sidebar" aria-label="管理后台导航">
        <div>
          <strong>Quiz Solver</strong>
          <p>Admin Console</p>
        </div>
        <nav>
          {[...pages.entries()].map(([href, [label]]) => (
            <a key={href} href={href} aria-current={currentPath === href ? "page" : undefined}>
              {label}
            </a>
          ))}
        </nav>
        <form method="POST" action="/admin/logout">
          <button type="submit">退出登录</button>
        </form>
      </aside>
      <main className="admin-main">
        <header>
          <p className="eyebrow">独立管理后台</p>
          <h1>{page[0]}</h1>
        </header>
        <section className="admin-card">
          <p>{page[1]}</p>
          <p className="muted">当前阶段只冻结平台、安全和构建边界，不展示虚构业务数据。</p>
        </section>
      </main>
    </div>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("Admin root element is missing");
createRoot(root).render(
  <React.StrictMode>
    <AdminApp />
  </React.StrictMode>,
);
