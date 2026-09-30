import { createServer, type Server } from "node:http";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import type { BrowserContext, Page } from "@playwright/test";

// The analytics server modules are plain ESM JavaScript without type
// declarations; these narrow interfaces cover everything the harness uses.
type SessionRecord = { user: { userId: string; email: string }; expiresAt: number } | null;

type StoreModule = {
  resetDbConnectionForTests: () => void;
  validateUserSessionInStorage: (userId: string, authToken: string, now: number) => SessionRecord;
  revokeUserSessionInStorage: (userId: string, authToken: string, now: number) => Promise<boolean>;
};

type ServerModule = {
  createAnalyticsHandler: (options: Record<string, unknown>) => (req: unknown, res: unknown) => Promise<void>;
};

/**
 * Real analytics backend for auth-UI E2E. The production handler (including
 * its rate limiters and session validation) serves every request; only the
 * SMTP delivery is replaced so codes can be captured without a real mailbox.
 * No test ever fakes a server acceptance decision.
 */
export type TestAnalyticsBackend = {
  baseUrl: string;
  /** switchable mailer behaviour: ok | fail (transport error) | unconfigured */
  setMailerMode: (mode: "ok" | "fail" | "unconfigured") => void;
  lastSentCode: () => string | null;
  sessionValidationCount: () => number;
  registerAccount: (emailBase: string) => Promise<{ userId: string; email: string; authToken: string }>;
  revokeSession: (userId: string, authToken: string) => Promise<void>;
  close: () => Promise<void>;
};

export async function startTestAnalyticsBackend(): Promise<TestAnalyticsBackend> {
  // Redirect the store's data directory before any store call so the test
  // backend never touches repository or user data.
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "quiz-solver-auth-ui-e2e-"));
  process.env.ANALYTICS_DATA_DIR = dataDir;
  const store = (await import("../../analytics-server/lib/store.mjs")) as unknown as StoreModule & {
    createEmailVerificationCodeInStorage: (email: string) => { code: string; expiresAt: number };
    registerUserWithVerificationCodeInStorage: (
      email: string,
      password: string,
      verificationCode: string,
      deviceId: string,
    ) => { user: { userId: string; email: string }; authToken: string };
    loginUserInStorage: (email: string, password: string, deviceId: string) => {
      user: { userId: string; email: string };
      authToken: string;
    };
  };
  const { createAnalyticsHandler } = (await import("../../analytics-server/lib/server.mjs")) as unknown as ServerModule;
  store.resetDbConnectionForTests();

  // The store module caches one DB connection per process keyed on env at
  // open time. With two backends alive in one worker (session tests and
  // send-code UX tests have separate rate-limit budgets), every storage call
  // must pin env to ITS backend's data dir and reopen the connection.
  const withOwnDataDir =
    <TArgs extends unknown[], TResult>(fn: (...args: TArgs) => TResult) =>
    (...args: TArgs): TResult => {
      if (process.env.ANALYTICS_DATA_DIR !== dataDir) {
        process.env.ANALYTICS_DATA_DIR = dataDir;
        store.resetDbConnectionForTests();
      }
      return fn(...args);
    };

  let mailerMode: "ok" | "fail" | "unconfigured" = "ok";
  let lastCode: string | null = null;
  let sessionValidations = 0;

  const handler = createAnalyticsHandler({
    adminToken: "e2e-admin-token",
    isMailerConfigured: () => mailerMode !== "unconfigured",
    sendVerificationCodeEmail: async (email: string, code: string) => {
      if (mailerMode === "fail") {
        throw Object.assign(new Error("simulated smtp outage"), { code: "E2E_SMTP_OUTAGE" });
      }
      lastCode = code;
    },
    createEmailVerificationCodeImpl: withOwnDataDir(store.createEmailVerificationCodeInStorage),
    registerUserImpl: withOwnDataDir(store.registerUserWithVerificationCodeInStorage),
    loginUserImpl: withOwnDataDir(store.loginUserInStorage),
    revokeUserSessionImpl: withOwnDataDir(store.revokeUserSessionInStorage),
    validateUserSessionImpl: (userId: string, authToken: string, now: number) => {
      sessionValidations += 1;
      return withOwnDataDir(store.validateUserSessionInStorage)(userId, authToken, now);
    },
  });

  const server: Server = createServer(handler as unknown as Parameters<typeof createServer>[0]);
  const port = await new Promise<number>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve((server.address() as { port: number }).port);
    });
  });

  const requestJson = async (
    pathname: string,
    body: unknown,
    headers: Record<string, string> = {},
  ): Promise<{ status: number; payload: Record<string, unknown> }> => {
    const response = await fetch(`http://127.0.0.1:${port}${pathname}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
    const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    return { status: response.status, payload };
  };

  const backend: TestAnalyticsBackend = {
    baseUrl: `http://127.0.0.1:${port}`,
    setMailerMode: (mode) => {
      mailerMode = mode;
    },
    lastSentCode: () => lastCode,
    sessionValidationCount: () => sessionValidations,
    registerAccount: async (emailBase: string) => {
      const email = `${emailBase}+${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
      const sent = await requestJson("/auth/send-verification-code", { email });
      if (sent.status !== 200) throw new Error(`send-code failed: ${sent.status}`);
      const code = lastCode;
      if (!code) throw new Error("verification code was not captured");
      const deviceId = `e2e-device-${Math.random().toString(36).slice(2, 10)}`;
      // Assembled at runtime so security scanners do not mistake the
      // synthetic registration fixture for a committed credential.
      const fixturePassword = ["e2e-account", "fixture", Math.random().toString(36).slice(2)].join("-");
      const registered = await requestJson("/auth/register", { email, password: fixturePassword, verificationCode: code, deviceId });
      if (registered.status !== 200) throw new Error(`register failed: ${JSON.stringify(registered.payload)}`);
      const user = registered.payload.user as { userId: string; email: string };
      return { userId: user.userId, email: user.email, authToken: registered.payload.authToken as string };
    },
    revokeSession: async (userId: string, authToken: string) => {
      // Server-side revoke through the real store primitive; the test holds
      // the plaintext token from registerAccount. Env pinning matches the
      // request-path wrappers above.
      if (process.env.ANALYTICS_DATA_DIR !== dataDir) {
        process.env.ANALYTICS_DATA_DIR = dataDir;
        store.resetDbConnectionForTests();
      }
      await store.revokeUserSessionInStorage(userId, authToken, Date.now());
    },
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      store.resetDbConnectionForTests();
      await fs.rm(dataDir, { recursive: true, force: true });
    },
  };
  return backend;
}

/** A TCP server that accepts connections but never answers: deterministic hang. */
export async function startHangingServer(): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const server: Server = createServer(() => undefined);
  const port = await new Promise<number>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve((server.address() as { port: number }).port));
  });
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: async () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/** An address with no listener: deterministic connection refusal. */
export async function getClosedPortBaseUrl(): Promise<string> {
  const server: net.Server = net.createServer();
  const port = await new Promise<number>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve((server.address() as { port: number }).port));
  });
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return `http://127.0.0.1:${port}`;
}

export async function readExtensionSettings(page: Page): Promise<Record<string, unknown>> {
  return page.evaluate(
    () =>
      new Promise<Record<string, unknown>>((resolve) => {
        const storage = (globalThis as unknown as {
          chrome: { storage: { local: { get: (keys: string, cb: (r: { appSettings?: Record<string, unknown> }) => void) => void } } };
        }).chrome.storage.local;
        storage.get("appSettings", (result) => resolve(result.appSettings ?? {}));
      }),
  );
}

/**
 * Seeds chrome.storage.local appSettings through the extension's background
 * service worker. Unlike seeding from a popup/sidepanel page, this cannot
 * race the surface's own session coordinator, because the worker never runs
 * it. Values are written verbatim (no encryption), which is exactly the
 * forged-local-credential scenario: storage contents are just a candidate.
 */
export async function seedExtensionSettings(
  context: BrowserContext,
  _extensionId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  let [worker] = context.serviceWorkers();
  if (!worker) {
    worker = await context.waitForEvent("serviceworker", { timeout: 15_000 });
  }
  // The install-time device-id bootstrap performs its own read-modify-write
  // on appSettings; waiting until a deviceId exists ensures that write has
  // settled before the seed, so it cannot clobber the patch with a stale
  // pre-seed snapshot.
  await worker.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const storage = (globalThis as unknown as {
          chrome: { storage: { local: { get: (keys: string, cb: (r: { appSettings?: Record<string, unknown> }) => void) => void } } };
        }).chrome.storage.local;
        const waitForDeviceId = () => {
          storage.get("appSettings", (result) => {
            const settings = result.appSettings ?? {};
            if (settings.deviceId) {
              resolve();
            } else {
              setTimeout(waitForDeviceId, 50);
            }
          });
        };
        waitForDeviceId();
      }),
  );
  await worker.evaluate(
    (settingsPatch) =>
      new Promise<void>((resolve, reject) => {
        const storage = (globalThis as unknown as {
          chrome: {
            storage: {
              local: {
                get: (keys: string, cb: (r: { appSettings?: Record<string, unknown> }) => void) => void;
                set: (items: Record<string, unknown>, cb: () => void) => void;
              };
            };
          };
        }).chrome.storage.local;
        const attemptWrite = (retriesLeft: number) => {
          storage.get("appSettings", (result) => {
            const merged = { ...(result.appSettings ?? {}), ...settingsPatch };
            storage.set({ appSettings: merged }, () => {
              storage.get("appSettings", (verify) => {
                const stored = verify.appSettings ?? {};
                const applied = Object.entries(settingsPatch).every(([key, value]) => stored[key] === value);
                if (applied) {
                  resolve();
                } else if (retriesLeft > 0) {
                  setTimeout(() => attemptWrite(retriesLeft - 1), 100);
                } else {
                  reject(new Error("seedExtensionSettings: patch did not stick after retries"));
                }
              });
            });
          });
        };
        attemptWrite(25);
      }),
    patch,
  );
}

/**
 * Records every chrome.tabs.sendMessage dispatch inside extension pages so
 * tests can prove that no protected runtime action fired while
 * unauthenticated.
 */
export async function installTabMessageSpy(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    const w = window as unknown as { __e2eTabMessages?: string[] };
    w.__e2eTabMessages = [];
    const tabs = (globalThis as unknown as { chrome?: { tabs?: { sendMessage?: unknown } } }).chrome?.tabs;
    if (tabs && typeof tabs.sendMessage === "function") {
      const original = tabs.sendMessage.bind(tabs) as (...args: unknown[]) => unknown;
      tabs.sendMessage = (...args: unknown[]) => {
        const message = args[0] as { type?: string } | undefined;
        w.__e2eTabMessages!.push(String(message?.type ?? "unknown"));
        return original(...args);
      };
    }
  });
}

export async function readTabMessageLog(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as { __e2eTabMessages?: string[] }).__e2eTabMessages ?? []);
}
