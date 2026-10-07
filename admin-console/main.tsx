import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { AdminShell } from "./components/AdminShell";
import { AlertCircleIcon, RefreshIcon } from "./components/Icons";
import "./admin.css";

export type SessionState =
  | { status: "loading" }
  | { status: "authenticated"; expiresAt: string | null; csrfToken: string }
  | { status: "error"; message: string };

export function normalizePath(pathname: string): string {
  const trimmed = pathname.replace(/\/+$/, "");
  return trimmed || "/admin";
}

export function AdminApp(): React.JSX.Element {
  const [session, setSession] = useState<SessionState>({ status: "loading" });
  const currentPath = normalizePath(window.location.pathname);

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
        return response.json() as Promise<{
          ok: true;
          expiresAt?: string | null;
          csrfToken?: string;
        }>;
      })
      .then((payload) => {
        if (payload) {
          if (!payload.csrfToken) throw new Error("ADMIN_CSRF_TOKEN_MISSING");
          setSession({
            status: "authenticated",
            expiresAt: payload.expiresAt ?? null,
            csrfToken: payload.csrfToken,
          });
        }
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setSession({
          status: "error",
          message:
            error instanceof Error
              ? error.message
              : "ADMIN_SESSION_CHECK_FAILED",
        });
      });

    return () => controller.abort();
  }, []);

  if (session.status === "loading") {
    return (
      <main className="admin-auth-screen" aria-live="polite">
        <div className="admin-auth-card">
          <div className="admin-auth-brand">
            <div className="admin-brand-icon" aria-hidden="true">
              QS
            </div>
            <strong className="admin-brand-title">Quiz Solver</strong>
            <span className="admin-brand-subtitle">管理后台</span>
          </div>
          <div className="admin-auth-loader">
            <div className="admin-spinner" aria-hidden="true" />
            <p className="admin-auth-loading-text">正在验证管理员会话…</p>
            <p className="admin-auth-hint">请稍候，正在验证访问权限</p>
          </div>
        </div>
      </main>
    );
  }

  if (session.status === "error") {
    return (
      <main className="admin-auth-screen" role="alert">
        <div className="admin-auth-card admin-auth-card-error">
          <div className="admin-error-icon-wrap" aria-hidden="true">
            <AlertCircleIcon size={32} />
          </div>
          <h1 className="admin-error-title">管理后台暂时不可用</h1>
          <p className="admin-error-desc">
            管理后台暂时不可用。请刷新页面后重试。
          </p>
          <button
            type="button"
            className="admin-retry-btn"
            onClick={() => window.location.reload()}
          >
            <RefreshIcon size={16} />
            <span>刷新页面</span>
          </button>
        </div>
      </main>
    );
  }

  return (
    <AdminShell
      currentPath={currentPath}
      expiresAt={session.expiresAt}
      csrfToken={session.csrfToken}
    />
  );
}

const rootElement = document.getElementById("root");
if (rootElement) {
  createRoot(rootElement).render(
    <React.StrictMode>
      <AdminApp />
    </React.StrictMode>,
  );
}
