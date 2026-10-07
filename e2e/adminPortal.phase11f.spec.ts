import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer as createPortProbe } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, type Page, type TestInfo } from "@playwright/test";

const ADMIN_TOKEN = "phase11f-admin-token-0123456789abcdef0123456789abcdef";
const ADMIN_AUDIT_TAG_KEY =
  "phase11f-audit-tag-key-0123456789abcdef0123456789abcdef";

let serverProcess: ChildProcess | null = null;
let dataDir = "";
let baseUrl = "";
let serverOutput = "";

async function reservePort(): Promise<number> {
  const probe = createPortProbe();
  await new Promise<void>((resolve, reject) => {
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => resolve());
  });
  const address = probe.address();
  if (!address || typeof address === "string") {
    probe.close();
    throw new Error("Unable to reserve a TCP port for the Admin browser gate");
  }
  const port = address.port;
  await new Promise<void>((resolve, reject) => {
    probe.close((error) => (error ? reject(error) : resolve()));
  });
  return port;
}

async function waitForServer(): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/healthz`, { cache: "no-store" });
      if (response.ok) return;
    } catch {
      // The child process may still be starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(
    `Admin server did not become ready. Output:\n${serverOutput.slice(-4000)}`,
  );
}

async function login(page: Page): Promise<void> {
  const response = await page.goto(`${baseUrl}/admin`, {
    waitUntil: "domcontentloaded",
  });
  expect(response?.url()).toBe(`${baseUrl}/admin/login`);
  expect(response?.headers()["content-security-policy"]).toContain(
    "default-src 'self'",
  );
  expect(response?.headers()["x-frame-options"]).toBe("DENY");

  await expect(
    page.getByRole("heading", { name: "Quiz Solver 管理后台" }),
  ).toBeVisible();
  await page.locator('input[name="adminToken"]').fill(ADMIN_TOKEN);

  const [loginResponse] = await Promise.all([
    page.waitForResponse(
      (candidate) =>
        candidate.url() === `${baseUrl}/admin/login` &&
        candidate.request().method() === "POST",
    ),
    page.getByRole("button", { name: "登录" }).click(),
  ]);
  const loginBody = await loginResponse.text();
  expect(
    loginResponse.status(),
    `Admin login POST failed with ${loginResponse.status()}: ${loginBody}. Server output: ${serverOutput.slice(-2000)}`,
  ).toBe(303);

  await page.waitForURL(`${baseUrl}/admin`, { waitUntil: "domcontentloaded" });

  await expect(
    page.getByRole("heading", { level: 1, name: "概览" }),
  ).toBeVisible();
}

async function assertNoPageOverflow(page: Page, label: string): Promise<void> {
  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
  expect(overflow, `${label} must not overflow the viewport`).toBeLessThanOrEqual(
    1,
  );
}

async function capture(
  page: Page,
  testInfo: TestInfo,
  name: string,
): Promise<void> {
  await page.screenshot({
    path: testInfo.outputPath(name),
    fullPage: true,
  });
}

test.describe("Phase 11F Admin real-browser final gate", () => {
  test.describe.configure({ mode: "serial", timeout: 120_000 });

  test.beforeAll(async () => {
    dataDir = mkdtempSync(join(tmpdir(), "quiz-solver-admin-11f-"));
    const port = await reservePort();
    baseUrl = `http://127.0.0.1:${port}`;

    const child = spawn(process.execPath, ["analytics-server/index.mjs"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        NODE_ENV: "test",
        ANALYTICS_HOST: "127.0.0.1",
        ANALYTICS_PORT: String(port),
        PUBLIC_BASE_URL: baseUrl,
        ANALYTICS_ADMIN_TOKEN: ADMIN_TOKEN,
        ANALYTICS_ADMIN_AUDIT_TAG_KEY: ADMIN_AUDIT_TAG_KEY,
        ANALYTICS_DATA_DIR: dataDir,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    serverProcess = child;
    child.stdout?.on("data", (chunk) => {
      serverOutput += chunk.toString();
    });
    child.stderr?.on("data", (chunk) => {
      serverOutput += chunk.toString();
    });

    await waitForServer();
  });

  test.afterAll(async () => {
    if (serverProcess && serverProcess.exitCode == null) {
      const exited = new Promise<void>((resolve) => {
        serverProcess?.once("exit", () => resolve());
      });
      serverProcess.kill();
      await Promise.race([
        exited,
        new Promise<void>((resolve) => setTimeout(resolve, 2_000)),
      ]);
    }
    if (dataDir) {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  test("11F-REAL-01 traverses every Admin route at four target widths without runtime or page overflow", async ({
    page,
  }, testInfo) => {
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("pageerror", (error) => pageErrors.push(error.message));

    await login(page);

    const routes = [
      { path: "/admin", title: "概览", slug: "overview" },
      { path: "/admin/analytics", title: "分析", slug: "analytics" },
      { path: "/admin/users", title: "用户", slug: "users" },
      { path: "/admin/system", title: "系统", slug: "system" },
      { path: "/admin/audit", title: "审计", slug: "audit" },
    ] as const;

    const viewports = [
      { width: 1440, height: 900 },
      { width: 1024, height: 768 },
      { width: 768, height: 900 },
      { width: 390, height: 844 },
    ] as const;

    for (const viewport of viewports) {
      await page.setViewportSize(viewport);

      for (const route of routes) {
        const response = await page.goto(`${baseUrl}${route.path}`, {
          waitUntil: "domcontentloaded",
        });
        expect(response?.status(), `${route.path} should return 200`).toBe(200);
        expect(response?.headers()["content-security-policy"]).toContain(
          "default-src 'self'",
        );
        expect(response?.headers()["x-frame-options"]).toBe("DENY");

        await expect(
          page.getByRole("heading", { level: 1, name: route.title }),
        ).toBeVisible();
        await assertNoPageOverflow(
          page,
          `${route.path} @ ${viewport.width}px`,
        );

        if (route.path === "/admin/audit") {
          await expect(page.getByText("管理员登录").first()).toBeVisible();
        }

        await capture(
          page,
          testInfo,
          `admin-${viewport.width}-${route.slug}.png`,
        );
      }
    }

    expect(consoleErrors, "Admin pages must not emit console errors").toEqual([]);
    expect(pageErrors, "Admin pages must not emit uncaught page errors").toEqual(
      [],
    );
  });

  test("11F-REAL-02 verifies desktop navigation, mobile drawer semantics, and real CSRF logout", async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await login(page);

    for (const route of [
      { label: "分析", path: "/admin/analytics" },
      { label: "用户", path: "/admin/users" },
      { label: "系统", path: "/admin/system" },
      { label: "审计", path: "/admin/audit" },
      { label: "概览", path: "/admin" },
    ] as const) {
      await page.getByRole("link", { name: route.label }).click();
      await expect(page).toHaveURL(`${baseUrl}${route.path}`);
      await expect(
        page.getByRole("heading", { level: 1, name: route.label }),
      ).toBeVisible();
    }

    await page.setViewportSize({ width: 390, height: 844 });
    const menuButton = page.getByRole("button", { name: "打开导航菜单" });
    await expect(menuButton).toBeVisible();
    await menuButton.click();
    await expect(menuButton).toHaveAttribute("aria-expanded", "true");
    await expect(
      page.locator("#admin-navigation-drawer"),
    ).toHaveClass(/is-mobile-open/);

    await page.getByRole("link", { name: "审计" }).click();
    await expect(page).toHaveURL(`${baseUrl}/admin/audit`);
    await expect(
      page.getByRole("heading", { level: 1, name: "审计" }),
    ).toBeVisible();
    await capture(page, testInfo, "admin-390-mobile-drawer-navigation.png");

    await page.setViewportSize({ width: 1440, height: 900 });
    await Promise.all([
      page.waitForURL(`${baseUrl}/admin/login`),
      page.getByRole("button", { name: "退出登录" }).click(),
    ]);
    await expect(
      page.getByRole("heading", { name: "Quiz Solver 管理后台" }),
    ).toBeVisible();

    await page.goto(`${baseUrl}/admin`, { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(`${baseUrl}/admin/login`);
    await capture(page, testInfo, "admin-post-logout-login.png");
  });
});
