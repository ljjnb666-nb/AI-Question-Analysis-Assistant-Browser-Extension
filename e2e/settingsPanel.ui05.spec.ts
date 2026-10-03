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
  await page.waitForSelector("#sidepanel-tabpanel-settings");
  // Give GSAP transitions and state actions time to settle
  await page.waitForTimeout(300);
}

async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await page.locator(".orbit-panel-scroll").evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
}

async function capture(page: Page, name: string) {
  await noOverflow(page);
  await page.evaluate(async () => {
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
    await capture(page, "ui05-zh-first-run.png");
  });

  test("ui05-en-first-run.png", async ({ page }) => {
    await open(page, "first-run", "en", 360);
    await capture(page, "ui05-en-first-run.png");
  });

  test("ui05-zh-provider-picker.png", async ({ page }) => {
    await open(page, "provider-picker", "zh", 360);
    await capture(page, "ui05-zh-provider-picker.png");
  });

  test("ui05-en-provider-picker.png", async ({ page }) => {
    await open(page, "provider-picker", "en", 360);
    await capture(page, "ui05-en-provider-picker.png");
  });

  test("ui05-api-key-hidden.png", async ({ page }) => {
    await open(page, "api-key-hidden", "zh", 360);
    await capture(page, "ui05-api-key-hidden.png");
  });

  test("ui05-api-key-visible-synthetic.png", async ({ page }) => {
    await open(page, "api-key-visible-synthetic", "zh", 360);
    await page.waitForTimeout(150);
    await capture(page, "ui05-api-key-visible-synthetic.png");
  });

  test("ui05-config-saved-not-tested.png", async ({ page }) => {
    await open(page, "config-saved-not-tested", "zh", 360);
    await page.waitForTimeout(200);
    await capture(page, "ui05-config-saved-not-tested.png");
  });

  test("ui05-validation-testing.png", async ({ page }) => {
    await open(page, "validation-testing", "zh", 360);
    await page.waitForTimeout(200);
    await capture(page, "ui05-validation-testing.png");
  });

  test("ui05-validation-success.png", async ({ page }) => {
    await open(page, "validation-success", "zh", 360);
    await page.waitForTimeout(400);
    await capture(page, "ui05-validation-success.png");
  });

  test("ui05-validation-error.png", async ({ page }) => {
    await open(page, "validation-error", "zh", 360);
    await page.waitForTimeout(400);
    await capture(page, "ui05-validation-error.png");
  });

  test("ui05-ollama.png", async ({ page }) => {
    await open(page, "ollama", "zh", 360);
    await capture(page, "ui05-ollama.png");
  });

  test("ui05-custom-provider.png", async ({ page }) => {
    await open(page, "custom", "zh", 360);
    await capture(page, "ui05-custom-provider.png");
  });

  test("ui05-ready.png", async ({ page }) => {
    await open(page, "ready", "zh", 360);
    await page.waitForTimeout(400);
    await capture(page, "ui05-ready.png");
  });

  test("ui05-320.png", async ({ page }) => {
    await open(page, "ready", "zh", 320);
    await page.waitForTimeout(300);
    await capture(page, "ui05-320.png");
  });

  test("ui05-360.png", async ({ page }) => {
    await open(page, "ready", "zh", 360);
    await page.waitForTimeout(300);
    await capture(page, "ui05-360.png");
  });

  test("ui05-400.png", async ({ page }) => {
    await open(page, "ready", "zh", 400);
    await page.waitForTimeout(300);
    await capture(page, "ui05-400.png");
  });

  test("ui05-480.png", async ({ page }) => {
    await open(page, "ready", "zh", 480);
    await page.waitForTimeout(300);
    await capture(page, "ui05-480.png");
  });
});
