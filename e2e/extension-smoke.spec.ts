import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { BrowserContext } from "@playwright/test";
import { chromium, expect, test } from "@playwright/test";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const extensionPath = path.resolve(__dirname, "..", "dist");
const playwrightCacheDir = path.join(os.homedir(), ".cache", "ms-playwright");

function resolveChromiumExecutable(): string {
  const chromiumDirs = fs
    .readdirSync(playwrightCacheDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^chromium-\d+$/.test(entry.name))
    .map((entry) => entry.name)
    .sort((left, right) => Number(right.split("-")[1]) - Number(left.split("-")[1]));

  for (const dirName of chromiumDirs) {
    const candidate = path.join(playwrightCacheDir, dirName, "chrome-win64", "chrome.exe");
    if (fs.existsSync(candidate)) return candidate;
  }

  throw new Error(`No Playwright Chromium executable found under ${playwrightCacheDir}`);
}

async function launchExtensionContext(): Promise<BrowserContext> {
  return chromium.launchPersistentContext("", {
    executablePath: resolveChromiumExecutable(),
    headless: false,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  });
}

async function resolveExtensionId(context: BrowserContext) {
  let [serviceWorker] = context.serviceWorkers();
  if (!serviceWorker) {
    serviceWorker = await context.waitForEvent("serviceworker");
  }

  return new URL(serviceWorker.url()).host;
}

test("loads the extension popup and renders the auth gate", async () => {
  const context = await launchExtensionContext();

  try {
    const extensionId = await resolveExtensionId(context);
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/popup/popup.html`);

    await expect(
      page.getByText(/(Register Account|Login Account|注册账号|登录账号|娉ㄥ唽|鐧诲綍)/),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: /^(Register|注册)$/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /^(Login|登录)$/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /(Send Code|发送验证码|鍙戦€侀獙璇佺爜)/ })).toBeVisible();
  } finally {
    await context.close();
  }
});

test("loads the sidepanel and defaults unauthenticated users to settings auth", async () => {
  const context = await launchExtensionContext();

  try {
    const extensionId = await resolveExtensionId(context);
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/sidepanel/sidepanel.html`);

    await expect(page.getByText(/(Login Account|登录账号|鐧诲綍璐﹀彿)/)).toBeVisible();
    await expect(page.getByRole("button", { name: /^(Register Page|注册页|娉ㄥ唽椤)$/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /^(Login Page|登录页|鐧诲綍椤)$/ })).toBeVisible();
    await expect(page.getByPlaceholder(/(Email|邮箱|閭)/)).toBeVisible();
    await expect(page.getByRole("button", { name: /(Send Code|发送验证码|鍙戦€侀獙璇佺爜)/ })).toBeVisible();
  } finally {
    await context.close();
  }
});
