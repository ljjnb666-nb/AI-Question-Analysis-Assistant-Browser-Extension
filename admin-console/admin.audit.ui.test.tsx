// @vitest-environment jsdom

import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AuditView } from "./components/audit/AuditView";

const originalLocation = window.location;

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  Object.defineProperty(window, "location", {
    configurable: true,
    value: originalLocation,
  });
});

describe("Phase 11E Admin Audit UI", () => {
  it("E-AUDIT-UI-01 renders only sanitized audit DTO semantics", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        generatedAt: "2026-10-07T12:00:00.000Z",
        data: [
          {
            auditId: "adm_1",
            event: "admin_login",
            outcome: "success",
            createdAt: "2026-10-07T11:59:00.000Z",
            ipHash: "ip_0123456789abcdef",
            sessionTag: "session_fedcba9876543210",
            metadata: { method: "POST", path: "/admin/login" },
          },
        ],
        page: { limit: 50, nextCursor: null },
      }),
    } as Response);

    render(<AuditView />);

    await waitFor(() => {
      expect(screen.getAllByText("管理员登录").length).toBeGreaterThanOrEqual(1);
    });
    expect(screen.getAllByText("成功").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("ip_0123456789abcdef").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("session_fedcba9876543210").length).toBeGreaterThanOrEqual(1);
    expect(document.body.textContent).not.toContain("adminToken");
    expect(document.body.textContent).not.toContain("csrfToken");
  });

  it("E-AUDIT-UI-02 appends cursor pages and keeps the cursor opaque", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = String(input);
      if (url.includes("cursor=opaque-audit-cursor")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            ok: true,
            generatedAt: "2026-10-07T12:01:00.000Z",
            data: [
              {
                auditId: "adm_2",
                event: "admin_logout",
                outcome: "success",
                createdAt: "2026-10-07T11:58:00.000Z",
                ipHash: null,
                sessionTag: "session_1111111111111111",
                metadata: null,
              },
            ],
            page: { limit: 50, nextCursor: null },
          }),
        } as Response);
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          generatedAt: "2026-10-07T12:00:00.000Z",
          data: [
            {
              auditId: "adm_1",
              event: "admin_login",
              outcome: "success",
              createdAt: "2026-10-07T11:59:00.000Z",
              ipHash: null,
              sessionTag: "session_2222222222222222",
              metadata: null,
            },
          ],
          page: { limit: 50, nextCursor: "opaque-audit-cursor" },
        }),
      } as Response);
    });

    render(<AuditView />);
    await waitFor(() => expect(screen.getByRole("button", { name: "加载更多" })).toBeDefined());

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "加载更多" }));
    });

    await waitFor(() => {
      expect(screen.getAllByText("管理员退出").length).toBeGreaterThanOrEqual(1);
    });
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("cursor=opaque-audit-cursor"))).toBe(true);
  });

  it("E-AUDIT-UI-03 redirects on 401 instead of rendering stale audit data", async () => {
    const replaceMock = vi.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: {
        ...originalLocation,
        replace: replaceMock,
      },
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: false,
      status: 401,
    } as Response);

    render(<AuditView />);

    await waitFor(() => {
      expect(replaceMock).toHaveBeenCalledWith("/admin/login");
    });
  });

  it("E-AUDIT-UI-04 renders bounded friendly errors without raw backend text", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({
        ok: false,
        error: { code: "ADMIN_STORAGE_UNAVAILABLE" },
      }),
    } as Response);

    render(<AuditView />);

    await waitFor(() => {
      expect(screen.getByText("审计记录暂时不可用")).toBeDefined();
    });
    expect(document.body.textContent).not.toContain("ADMIN_STORAGE_UNAVAILABLE");
  });
});
