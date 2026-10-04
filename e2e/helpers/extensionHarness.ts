import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { BrowserContext } from "@playwright/test";
import { chromium } from "@playwright/test";
import { installCanonicalOpenAIFixtureRoute } from "./aiConnectionHarness";

const extensionPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "dist");
const userDataDirs = new WeakMap<BrowserContext, string>();

export async function launchExtensionContext(): Promise<BrowserContext> {
  const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "quiz-solver-extension-e2e-"));
  try {
    const context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
      ],
    });
    userDataDirs.set(context, userDataDir);
    await installCanonicalOpenAIFixtureRoute(context);
    return context;
  } catch (error) {
    await fs.rm(userDataDir, { recursive: true, force: true });
    throw error;
  }
}

export async function resolveExtensionId(context: BrowserContext): Promise<string> {
  let [serviceWorker] = context.serviceWorkers();
  if (!serviceWorker) serviceWorker = await context.waitForEvent("serviceworker");
  return new URL(serviceWorker.url()).host;
}

export async function closeExtensionContext(context: BrowserContext): Promise<void> {
  const userDataDir = userDataDirs.get(context);
  try {
    // A held provider response may intentionally remain pending at test end.
    // Remove fixture handlers before disposing their request context.
    await context.unrouteAll({ behavior: "ignoreErrors" });
    await context.close();
  } finally {
    userDataDirs.delete(context);
    if (userDataDir) await fs.rm(userDataDir, { recursive: true, force: true });
  }
}
