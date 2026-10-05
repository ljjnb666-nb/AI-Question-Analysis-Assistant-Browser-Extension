import { test, expect, type Page } from "@playwright/test";
import { createServer, type ViteDevServer } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import fs from "node:fs/promises";

let server: ViteDevServer;
test.use({ headless: false });
let origin: string;
const evidence = path.resolve("docs/evidence/ui05");

test.beforeAll(async () => {
  server = await createServer({
    configFile: false,
    plugins: [react()],
    resolve: { alias: { "@": path.resolve("src") } },
    server: { host: "127.0.0.1", port: 0 },
  });
  await server.listen();
  origin = server.resolvedUrls!.local[0];
  await fs.mkdir(evidence, { recursive: true });
});

test.afterAll(async () => {
  await server?.close();
});

async function open(page: Page, state = "first-run", lang = "zh", width = 360) {
  await page.setViewportSize({ width, height: 860 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(`${origin}e2e/fixtures/ui05.html?state=${state}&lang=${lang}`);
  await page.waitForLoadState("domcontentloaded");
  await expect(page.locator("#sidepanel-tabpanel-settings")).toBeVisible();

  // Semantic settlement wait strictly replacing arbitrary setTimeout(300)
  if (state === "provider-picker") {
    await expect(page.locator('[data-testid="settings-catalog-view"]')).toBeVisible();
  } else if (
    state === "api-key-hidden" ||
    state === "api-key-visible-synthetic" ||
    state === "config-saved-not-tested" ||
    state === "validation-testing" ||
    state === "validation-error" ||
    state === "validation-success" ||
    state === "ollama" ||
    state === "custom"
  ) {
    await expect(page.locator('[data-testid="settings-editor-view"]')).toBeVisible();
  } else {
    await expect(page.locator('[data-testid="settings-home-view"]')).toBeVisible();
  }
}

async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await page.locator(".orbit-panel-scroll").evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
}

async function capture(page: Page, name: string) {
  await noOverflow(page);
  await page.evaluate(async () => {
    const scroller = document.querySelector(".orbit-panel-scroll");
    if (scroller) scroller.scrollTop = 0;
    await document.fonts.ready;
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  });
  const buffer = await page.screenshot({ animations: "disabled" });
  const writeSafe = async (filePath: string) => {
    for (let i = 0; i < 5; i++) {
      try {
        await fs.writeFile(filePath, buffer);
        return;
      } catch {
        await new Promise((r) => setTimeout(r, 100));
      }
    }
  };
  await writeSafe(path.join(evidence, name));
}

test.describe("UI-05: Visual Evidence & First-Run Redesign Screenshots", () => {
  test("ui05-zh-first-run.png", async ({ page }) => {
    await open(page, "first-run", "zh", 360);
    await expect(page.getByText("未配置 AI 服务")).toBeVisible();
    await expect(page.locator('[data-testid="first-run-signin-section"]')).toBeVisible();
    await capture(page, "ui05-zh-first-run.png");
  });

  test("ui05-en-first-run.png", async ({ page }) => {
    await open(page, "first-run", "en", 360);
    await expect(page.getByText("AI Provider Not Configured")).toBeVisible();
    await expect(page.locator('[data-testid="first-run-signin-section"]')).toBeVisible();
    await capture(page, "ui05-en-first-run.png");
  });

  test("ui05-zh-provider-picker.png", async ({ page }) => {
    await open(page, "provider-picker", "zh", 360);
    await expect(page.locator('[data-testid="settings-provider-picker"]')).toBeVisible();
    await capture(page, "ui05-zh-provider-picker.png");
  });

  test("ui05-en-provider-picker.png", async ({ page }) => {
    await open(page, "provider-picker", "en", 360);
    await expect(page.locator('[data-testid="settings-provider-picker"]')).toBeVisible();
    await capture(page, "ui05-en-provider-picker.png");
  });

  test("ui05-api-key-hidden.png", async ({ page }) => {
    await open(page, "api-key-hidden", "zh", 360);
    await expect(page.locator('input[type="password"][data-testid="settings-api-key-input"]')).toBeVisible();
    await capture(page, "ui05-api-key-hidden.png");
  });

  test("ui05-api-key-visible-synthetic.png", async ({ page }) => {
    await open(page, "api-key-visible-synthetic", "zh", 360);
    await expect(page.locator('input[type="text"][data-testid="settings-api-key-input"]')).toBeVisible();
    await capture(page, "ui05-api-key-visible-synthetic.png");
  });

  test("ui05-config-saved-not-tested.png", async ({ page }) => {
    await open(page, "config-saved-not-tested", "zh", 360);
    await expect(page.getByText("已保存（待测试）")).toBeVisible();
    await capture(page, "ui05-config-saved-not-tested.png");
  });

  test("ui05-validation-testing.png", async ({ page }) => {
    await open(page, "validation-testing", "zh", 360);
    const testBtn = page.locator('[data-testid="settings-editor-view"]').getByRole("button", { name: /连接测试|测试配置/ });
    await expect(testBtn).toBeVisible();
    await testBtn.click();
    await expect(page.getByText("正在测试配置...")).toBeVisible();
    const loadingBtn = page.locator('[data-testid="settings-editor-view"]').getByRole("button", { name: /测试中\.\.\.|Testing\.\.\./ });
    await expect(loadingBtn).toBeDisabled();
    await capture(page, "ui05-validation-testing.png");
  });

  test("ui05-validation-success.png", async ({ page }) => {
    await open(page, "validation-success", "zh", 360);
    const testBtn = page.locator('[data-testid="settings-editor-view"]').getByRole("button", { name: /连接测试|测试配置/ });
    await expect(testBtn).toBeVisible();
    await testBtn.click();
    await expect(page.locator('[data-test-tone="success"]')).toBeVisible();
    await capture(page, "ui05-validation-success.png");
  });

  test("ui05-validation-error.png", async ({ page }) => {
    await open(page, "validation-error", "zh", 360);
    const testBtn = page.locator('[data-testid="settings-editor-view"]').getByRole("button", { name: /连接测试|测试配置/ });
    await expect(testBtn).toBeVisible();
    await testBtn.click();
    await expect(page.getByText("连接测试失败")).toBeVisible();
    await expect(page.locator('[data-test-tone="error"]')).toBeVisible();
    await capture(page, "ui05-validation-error.png");
  });

  test("ui05-ollama.png", async ({ page }) => {
    await open(page, "ollama", "zh", 360);
    await expect(page.locator('[data-testid="settings-editor-view"]')).toBeVisible();
    await capture(page, "ui05-ollama.png");
  });

  test("ui05-custom-provider.png", async ({ page }) => {
    await open(page, "custom", "zh", 360);
    await expect(page.locator('[data-testid="settings-editor-view"]')).toBeVisible();
    await capture(page, "ui05-custom-provider.png");
  });

  test("ui05-ready.png", async ({ page }) => {
    await open(page, "ready", "zh", 360);
    await expect(page.locator('[data-testid="settings-ready-banner"]')).toBeVisible();
    await expect(page.getByText("已保存（待测试）")).toHaveCount(0);
    await capture(page, "ui05-ready.png");
  });

  test("ui05-320.png", async ({ page }) => {
    await open(page, "ready", "zh", 320);
    await expect(page.locator('[data-testid="settings-ready-banner"]')).toBeVisible();
    await capture(page, "ui05-320.png");
  });

  test("ui05-360.png", async ({ page }) => {
    await open(page, "ready", "zh", 360);
    await expect(page.locator('[data-testid="settings-ready-banner"]')).toBeVisible();
    await capture(page, "ui05-360.png");
  });

  test("ui05-400.png", async ({ page }) => {
    await open(page, "ready", "zh", 400);
    await expect(page.locator('[data-testid="settings-ready-banner"]')).toBeVisible();
    await capture(page, "ui05-400.png");
  });

  test("ui05-480.png", async ({ page }) => {
    await open(page, "ready", "zh", 480);
    await expect(page.locator('[data-testid="settings-ready-banner"]')).toBeVisible();
    await capture(page, "ui05-480.png");
  });
});

