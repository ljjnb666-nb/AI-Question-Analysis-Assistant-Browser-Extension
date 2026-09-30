import { expect, test, type Page } from "@playwright/test";
import { closeExtensionContext, launchExtensionContext, resolveExtensionId } from "./helpers/extensionHarness";
import {
  getClosedPortBaseUrl,
  installTabMessageSpy,
  readExtensionSettings,
  readTabMessageLog,
  seedExtensionSettings,
  startHangingServer,
  startTestAnalyticsBackend,
  type TestAnalyticsBackend,
} from "./helpers/authUiHarness";

/**
 * Auth-UI lifecycle E2E against the REAL extension build and the REAL
 * analytics handler. Nothing fakes server acceptance: forged tokens are
 * rejected by the actual session validation path.
 */

const POPUP_URL = (extensionId: string) => `chrome-extension://${extensionId}/popup/popup.html`;
const SIDEPANEL_URL = (extensionId: string) => `chrome-extension://${extensionId}/sidepanel/sidepanel.html`;

const FORGED_TOKEN = ["e2e", "forged", Math.random().toString(36).slice(2)].join("-");

let backend: TestAnalyticsBackend;
let mailBackend: TestAnalyticsBackend;
// Pre-registered accounts: registration burns send-code quota, and the
// backend's per-IP limit (10 per 15 min) is shared by the whole suite, so
// tests reuse accounts instead of registering their own.
let accountA: TestAccount;
let accountB: TestAccount;
let accountC: TestAccount;
let accountD: TestAccount;

test.beforeAll(async () => {
  backend = await startTestAnalyticsBackend();
  mailBackend = await startTestAnalyticsBackend();
  accountA = await backend.registerAccount("auth-ui-shared-a");
  accountB = await backend.registerAccount("auth-ui-shared-b");
  accountC = await backend.registerAccount("auth-ui-shared-c");
  accountD = await backend.registerAccount("auth-ui-shared-d");
});

test.afterAll(async () => {
  await backend.close();
  await mailBackend.close();
});

type TestAccount = { userId: string; email: string; authToken: string };

async function seedValidSession(
  context: Awaited<ReturnType<typeof launchExtensionContext>>,
  extensionId: string,
  account: TestAccount,
  baseUrl = backend.baseUrl,
): Promise<void> {
  await seedExtensionSettings(context, extensionId, {
    analyticsBaseUrl: baseUrl,
    userId: account.userId,
    userEmail: account.email,
    authToken: account.authToken,
  });
}

async function expectEventually(
  page: Page,
  poll: () => Promise<boolean>,
  options: { timeout?: number; interval?: number } = {},
): Promise<void> {
  const timeout = options.timeout ?? 15_000;
  const interval = options.interval ?? 250;
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await poll()) return;
    await page.waitForTimeout(interval);
  }
  throw new Error("condition not met before timeout");
}

const isValidating = (page: Page) =>
  page.getByText(/(正在验证登录状态|Verifying session)/).first().isVisible().catch(() => false);

// The auth form is identifiable by its primary submit affordance: Send Code
// on the register view, or the Login button after a logout resets the view.
// first() keeps the poll strict-mode-safe (register view also renders a
// "登录" tab button next to "发送验证码").
const isAuthFormVisible = (page: Page) =>
  page
    .getByRole("button", { name: /^(Send Code|发送验证码|Login|登录)$/ })
    .first()
    .isVisible()
    .catch(() => false);

// Authenticated = the protected actions card is rendered. The hero copy
// varies with API-key configuration ("准备开始" vs "完成配置"), so the
// action buttons are the stable unlock signal.
const isUnlocked = (page: Page) =>
  manualCaptureButton(page).first().isVisible().catch(() => false);

const manualCaptureButton = (page: Page) => page.getByRole("button", { name: /(手动截图|Manual Capture)/i });
const fullPageButton = (page: Page) => page.getByRole("button", { name: /(整页扫描|Scan Full Page)/i });
// Exact header copy: the locked state also mentions 工作台 ("工作台未解锁"),
// so the workspace header must be matched exactly.
const sidepanelWorkspaceHeader = (page: Page) => page.getByText(/^(工作台|Workspace)$/);

// ---------------------------------------------------------------------------
// AUTH_UI_01 — the headline acceptance: forged local credentials never unlock
// the UI on any surface and converge to unauthenticated after server reject.
// ---------------------------------------------------------------------------
test("AUTH_UI_01_FORGED_LOCAL_CREDENTIALS popup and sidepanel reject forged storage", async () => {
  test.setTimeout(90_000);
  const context = await launchExtensionContext();
  try {
    const extensionId = await resolveExtensionId(context);
    await installTabMessageSpy(context);
    await seedExtensionSettings(context, extensionId, {
      analyticsBaseUrl: backend.baseUrl,
      userId: "usr-forged-e2e",
      userEmail: "forged@example.com",
      authToken: FORGED_TOKEN,
    });

    // --- Popup surface ---
    const popup = await context.newPage();
    await popup.goto(POPUP_URL(extensionId));
    await expect(popup.getByText(/(准备开始|Ready to Work)/)).toHaveCount(0, { timeout: 5_000 });
    await expect(manualCaptureButton(popup)).toHaveCount(0, { timeout: 5_000 });
    // Session validation must have run against the real server; rejection
    // cleared the forged credentials.
    await expectEventually(popup, () => isAuthFormVisible(popup), { timeout: 25_000 });
    await expectEventually(popup, async () => {
      const settings = await readExtensionSettings(popup);
      return !settings.authToken && !settings.userId;
    });
    expect(await readTabMessageLog(popup)).toEqual([]);

    // --- Side Panel surface (fresh forged write) ---
    // Close the popup first: its session coordinator would legitimately
    // reject and clear the newly seeded forged credentials mid-write,
    // racing the seed's read-back verification.
    await popup.close();
    await seedExtensionSettings(context, extensionId, {
      userId: "usr-forged-e2e",
      userEmail: "forged@example.com",
      authToken: FORGED_TOKEN,
    });
    const sidepanel = await context.newPage();
    await sidepanel.goto(SIDEPANEL_URL(extensionId));
    await expect(sidepanelWorkspaceHeader(sidepanel)).toHaveCount(0, { timeout: 5_000 });
    await expectEventually(sidepanel, () => isAuthFormVisible(sidepanel), { timeout: 25_000 });
    await expectEventually(sidepanel, async () => {
      const settings = await readExtensionSettings(sidepanel);
      return !settings.authToken && !settings.userId;
    });
    expect(await readTabMessageLog(sidepanel)).toEqual([]);
  } finally {
    await closeExtensionContext(context);
  }
});

// ---------------------------------------------------------------------------
// AUTH_UI_02 + no-flash — a valid cached session unlocks through real server
// validation, and a hung server must keep the first frame fail-closed.
// ---------------------------------------------------------------------------
test("AUTH_UI_02_VALID_SESSION_STARTUP validates cached credentials and unlocks", async () => {
  test.setTimeout(90_000);
  const context = await launchExtensionContext();
  try {
    const extensionId = await resolveExtensionId(context);
    const account = accountA;
    await seedValidSession(context, extensionId, account);

    const popup = await context.newPage();
    await popup.goto(POPUP_URL(extensionId));
    await expectEventually(popup, () => isUnlocked(popup), { timeout: 25_000 });
    await expect(manualCaptureButton(popup).first()).toBeVisible();
  } finally {
    await closeExtensionContext(context);
  }
});

test("AUTH_UI_02B_NO_AUTHENTICATED_FLASH hung validation keeps the first frame locked", async () => {
  test.setTimeout(90_000);
  const context = await launchExtensionContext();
  const hanging = await startHangingServer();
  try {
    const extensionId = await resolveExtensionId(context);
    const account = accountA;
    await seedValidSession(context, extensionId, account, hanging.baseUrl);

    const popup = await context.newPage();
    await popup.goto(POPUP_URL(extensionId));
    // While validation is pending: the validating state is visible and no
    // authenticated UI flashes at any point in the window.
    await expectEventually(popup, () => isValidating(popup), { timeout: 10_000 });
    for (let check = 0; check < 8; check += 1) {
      expect(await isUnlocked(popup)).toBe(false);
      expect(await manualCaptureButton(popup).count()).toBe(0);
      await popup.waitForTimeout(400);
    }
  } finally {
    await hanging.close();
    await closeExtensionContext(context);
  }
});

// ---------------------------------------------------------------------------
// AUTH_UI_03..05 — startup with an invalid cached token on each surface.
// ---------------------------------------------------------------------------
test("AUTH_UI_03_POPUP_STARTUP_INVALID no authenticated flash, converges unauthenticated", async () => {
  test.setTimeout(90_000);
  const context = await launchExtensionContext();
  try {
    const extensionId = await resolveExtensionId(context);
    await seedExtensionSettings(context, extensionId, {
      analyticsBaseUrl: backend.baseUrl,
      userId: "usr-stale-popup",
      userEmail: "stale-popup@example.com",
      authToken: FORGED_TOKEN,
    });
    const popup = await context.newPage();
    await popup.goto(POPUP_URL(extensionId));
    // First frame must be validating/locked, never authenticated. Poll
    // instead of sampling once: goto resolves before React's first commit.
    await expect(async () => {
      expect(await isAuthFormVisible(popup) || (await isValidating(popup))).toBe(true);
    }).toPass({ timeout: 10_000 });
    await expect(popup.getByText(/(准备开始|Ready to Work)/)).toHaveCount(0, { timeout: 5_000 });
    await expectEventually(popup, () => isAuthFormVisible(popup), { timeout: 25_000 });
    expect(await readExtensionSettings(popup).then((s) => !s.authToken)).toBe(true);
  } finally {
    await closeExtensionContext(context);
  }
});

test("AUTH_UI_04_SIDEPANEL_STARTUP_INVALID no authenticated flash, converges unauthenticated", async () => {
  test.setTimeout(90_000);
  const context = await launchExtensionContext();
  try {
    const extensionId = await resolveExtensionId(context);
    await seedExtensionSettings(context, extensionId, {
      analyticsBaseUrl: backend.baseUrl,
      userId: "usr-stale-panel",
      userEmail: "stale-panel@example.com",
      authToken: FORGED_TOKEN,
    });
    const sidepanel = await context.newPage();
    await sidepanel.goto(SIDEPANEL_URL(extensionId));
    await expectEventually(sidepanel, () => isAuthFormVisible(sidepanel), { timeout: 25_000 });
    await expect(sidepanelWorkspaceHeader(sidepanel)).toHaveCount(0, { timeout: 5_000 });
    expect(await readExtensionSettings(sidepanel).then((s) => !s.authToken)).toBe(true);
  } finally {
    await closeExtensionContext(context);
  }
});

test("AUTH_UI_05_SETTINGS_STARTUP_INVALID shows session-expired feedback, not a signed-in account", async () => {
  test.setTimeout(90_000);
  const context = await launchExtensionContext();
  try {
    const extensionId = await resolveExtensionId(context);
    await seedExtensionSettings(context, extensionId, {
      analyticsBaseUrl: backend.baseUrl,
      userId: "usr-stale-settings",
      userEmail: "stale-settings@example.com",
      authToken: FORGED_TOKEN,
    });
    const sidepanel = await context.newPage();
    await sidepanel.goto(SIDEPANEL_URL(extensionId));
    await expectEventually(
      sidepanel,
      () => sidepanel.getByText(/(登录已失效|session has expired)/i).first().isVisible(),
      { timeout: 25_000 },
    );
    await expect(sidepanel.getByText(/(当前账号|Current Account)/).first()).toHaveCount(0, { timeout: 5_000 });
  } finally {
    await closeExtensionContext(context);
  }
});

// ---------------------------------------------------------------------------
// AUTH_UI_06..08 — valid sessions and cross-surface convergence.
// ---------------------------------------------------------------------------
test("AUTH_UI_06_VALID_SESSION_ALL_SURFACES popup, sidepanel, and settings converge authenticated", async () => {
  test.setTimeout(120_000);
  const context = await launchExtensionContext();
  try {
    const extensionId = await resolveExtensionId(context);
    const account = accountA;
    await seedValidSession(context, extensionId, account);

    const popup = await context.newPage();
    await popup.goto(POPUP_URL(extensionId));
    const sidepanel = await context.newPage();
    await sidepanel.goto(SIDEPANEL_URL(extensionId));

    await expectEventually(popup, () => isUnlocked(popup), { timeout: 25_000 });
    await expectEventually(sidepanel, () => sidepanelWorkspaceHeader(sidepanel).first().isVisible(), {
      timeout: 25_000,
    });
    // Settings surface reached through the authenticated header tabs.
    await sidepanel.getByRole("button", { name: /^(设置|Settings)$/ }).click();
    await expect(sidepanel.getByText(/(当前账号|Current Account)/).first()).toBeVisible({ timeout: 15_000 });
  } finally {
    await closeExtensionContext(context);
  }
});

test("AUTH_UI_07_LOGIN_PROPAGATION login on one surface revalidates the other via the server", async () => {
  test.setTimeout(120_000);
  const context = await launchExtensionContext();
  try {
    const extensionId = await resolveExtensionId(context);
    // Point auth traffic at the test backend before any surface boots.
    await seedExtensionSettings(context, extensionId, { analyticsBaseUrl: backend.baseUrl });
    const popup = await context.newPage();
    await popup.goto(POPUP_URL(extensionId));
    const sidepanel = await context.newPage();
    await sidepanel.goto(SIDEPANEL_URL(extensionId));
    await expectEventually(sidepanel, () => isAuthFormVisible(sidepanel), { timeout: 25_000 });
    await expectEventually(popup, () => isAuthFormVisible(popup), { timeout: 25_000 });

    // Register on the sidepanel surface.
    const email = `auth-ui-07+${Date.now()}@example.com`;
    await sidepanel.getByPlaceholder(/(Email|邮箱)/).fill(email);
    await sidepanel.getByRole("button", { name: /^(Send Code|发送验证码)$/ }).click();
    await expectEventually(sidepanel, () => sidepanel.getByText(/验证码已发送/).first().isVisible(), { timeout: 25_000 });
    const code = backend.lastSentCode();
    expect(code).toBeTruthy();
    // Assembled at runtime so security scanners do not mistake the synthetic
    // registration fixture for a committed credential.
    const fixturePassword = ["e2e-register", "fixture", Math.random().toString(36).slice(2)].join("-");
    await sidepanel.getByPlaceholder(/(Password|密码)/).fill(fixturePassword);
    // The verification code renders as six single-digit slots; typing the
    // full code into the first slot distributes it across the group.
    await sidepanel.locator('input[inputmode="numeric"]').first().fill(code!);
    await sidepanel.getByRole("button", { name: /^(Complete Registration|完成注册)$/ }).click();

    // The sidepanel flips to the account card via the server-backed response.
    await expectEventually(sidepanel, () => sidepanel.getByText(/(当前账号|Current Account)/).first().isVisible(), {
      timeout: 25_000,
    });
    // The popup, open the whole time, revalidates on the storage change.
    await expectEventually(popup, () => isUnlocked(popup), { timeout: 25_000 });
  } finally {
    await closeExtensionContext(context);
  }
});

test("AUTH_UI_08_LOGOUT_PROPAGATION logout converges every surface to unauthenticated", async () => {
  test.setTimeout(120_000);
  const context = await launchExtensionContext();
  try {
    const extensionId = await resolveExtensionId(context);
    const account = accountB;
    await seedValidSession(context, extensionId, account);

    const popup = await context.newPage();
    await popup.goto(POPUP_URL(extensionId));
    const sidepanel = await context.newPage();
    await sidepanel.goto(SIDEPANEL_URL(extensionId));
    await expectEventually(popup, () => isUnlocked(popup), { timeout: 25_000 });

    await sidepanel.getByRole("button", { name: /^(设置|Settings)$/ }).click();
    await expect(sidepanel.getByText(/(当前账号|Current Account)/).first()).toBeVisible({ timeout: 15_000 });
    await sidepanel.getByRole("button", { name: /^(Logout|退出登录)$/ }).click();

    await expectEventually(sidepanel, () => isAuthFormVisible(sidepanel), { timeout: 25_000 });
    await expectEventually(popup, () => isAuthFormVisible(popup), { timeout: 25_000 });
    const settings = await readExtensionSettings(sidepanel);
    expect(!settings.authToken).toBe(true);
  } finally {
    await closeExtensionContext(context);
  }
});

// ---------------------------------------------------------------------------
// AUTH_UI_09..11 — server unavailable, recovery, expired sessions.
// ---------------------------------------------------------------------------
test("AUTH_UI_09_SERVER_UNAVAILABLE credentials retained, protected UI stays locked", async () => {
  test.setTimeout(120_000);
  const context = await launchExtensionContext();
  try {
    const extensionId = await resolveExtensionId(context);
    const closedBase = await getClosedPortBaseUrl();
    const account = accountC;
    await seedValidSession(context, extensionId, account, closedBase);

    const popup = await context.newPage();
    await popup.goto(POPUP_URL(extensionId));
    await expectEventually(
      popup,
      () => popup.getByText(/(暂时无法验证登录状态|Can't verify sign-in)/).first().isVisible(),
      { timeout: 30_000 },
    );
    await expect(popup.getByText(/(准备开始|Ready to Work)/)).toHaveCount(0, { timeout: 5_000 });
    await expect(popup.getByRole("button", { name: /^(重试|Retry)$/ })).toBeVisible();
    await expect(popup.getByRole("button", { name: /^(重置|Reset|退出登录|Logout)$/ })).toBeVisible();

    const sidepanel = await context.newPage();
    await sidepanel.goto(SIDEPANEL_URL(extensionId));
    await expectEventually(
      sidepanel,
      () => sidepanel.getByText(/(暂时无法验证登录状态|Can't verify sign-in)/).first().isVisible(),
      { timeout: 30_000 },
    );
    const settings = await readExtensionSettings(sidepanel);
    expect(settings.authToken).toBe(account.authToken);
  } finally {
    await closeExtensionContext(context);
  }
});

test("AUTH_UI_10_SERVER_RECOVERY retry stays safe while down; healing converges authenticated", async () => {
  test.setTimeout(120_000);
  const context = await launchExtensionContext();
  try {
    const extensionId = await resolveExtensionId(context);
    const closedBase = await getClosedPortBaseUrl();
    const account = accountC;
    await seedValidSession(context, extensionId, account, closedBase);

    const popup = await context.newPage();
    await popup.goto(POPUP_URL(extensionId));
    await expectEventually(
      popup,
      () => popup.getByText(/(暂时无法验证登录状态|Can't verify sign-in)/).first().isVisible(),
      { timeout: 30_000 },
    );

    // Retry while the network is still down: stays locked, stays safe.
    await popup.getByRole("button", { name: /^(重试|Retry)$/ }).click();
    await expect(popup.getByText(/(准备开始|Ready to Work)/)).toHaveCount(0, { timeout: 5_000 });

    // Heal the network: the storage-driven reconciliation revalidates.
    await seedExtensionSettings(context, extensionId, { analyticsBaseUrl: backend.baseUrl });
    await expectEventually(popup, () => isUnlocked(popup), { timeout: 30_000 });
  } finally {
    await closeExtensionContext(context);
  }
});

test("AUTH_UI_11_EXPIRED_SESSION 401 clears credentials and shows the sign-in-again state", async () => {
  test.setTimeout(120_000);
  const context = await launchExtensionContext();
  try {
    const extensionId = await resolveExtensionId(context);
    const account = accountC;
    await backend.revokeSession(account.userId, account.authToken);
    await seedValidSession(context, extensionId, account);

    const popup = await context.newPage();
    await popup.goto(POPUP_URL(extensionId));
    await expectEventually(popup, () => isAuthFormVisible(popup), { timeout: 30_000 });
    await expectEventually(popup, async () => {
      const settings = await readExtensionSettings(popup);
      return !settings.authToken && !settings.userId;
    });
    await expect(popup.getByText(/(准备开始|Ready to Work)/)).toHaveCount(0, { timeout: 5_000 });
  } finally {
    await closeExtensionContext(context);
  }
});

// ---------------------------------------------------------------------------
// AUTH_UI_12..15 — races, loops, protected handler gate.
// ---------------------------------------------------------------------------
test("AUTH_UI_12_VALIDATION_RACE_LOGOUT stale hung validation cannot win over logout", async () => {
  test.setTimeout(120_000);
  const context = await launchExtensionContext();
  const hanging = await startHangingServer();
  try {
    const extensionId = await resolveExtensionId(context);
    const account = accountA;
    await seedValidSession(context, extensionId, account, hanging.baseUrl);

    const sidepanel = await context.newPage();
    await sidepanel.goto(SIDEPANEL_URL(extensionId));
    // Validation A is now held open by the hanging server.
    await expectEventually(sidepanel, () => isValidating(sidepanel), { timeout: 10_000 });

    // Newer state lands while A is still in flight: restore the working
    // backend, let the coordinator revalidate, then log out.
    await seedExtensionSettings(context, extensionId, { analyticsBaseUrl: backend.baseUrl });
    await expectEventually(sidepanel, () => sidepanelWorkspaceHeader(sidepanel).first().isVisible(), {
      timeout: 30_000,
    });
    await sidepanel.getByRole("button", { name: /^(设置|Settings)$/ }).click();
    await expectEventually(sidepanel, () => sidepanel.getByText(/(当前账号|Current Account)/).first().isVisible(), {
      timeout: 20_000,
    });
    await sidepanel.getByRole("button", { name: /^(Logout|退出登录)$/ }).click();
    await expectEventually(sidepanel, () => isAuthFormVisible(sidepanel), { timeout: 25_000 });

    // When the hung validation finally times out (12s client timeout), it
    // must NOT resurrect the logged-in state.
    await sidepanel.waitForTimeout(14_000);
    expect(await isAuthFormVisible(sidepanel)).toBe(true);
    const settings = await readExtensionSettings(sidepanel);
    expect(!settings.authToken).toBe(true);
  } finally {
    await hanging.close();
    await closeExtensionContext(context);
  }
});

test("AUTH_UI_13_VALIDATION_RACE_RELOGIN newest credentials win over stale validation", async () => {
  test.setTimeout(120_000);
  const context = await launchExtensionContext();
  try {
    const extensionId = await resolveExtensionId(context);
    // accountA was revoked server-side by AUTH_UI_12's logout: a perfect
    // stale-session fixture without burning more send-code quota.
    const staleAccount = accountA;
    await seedValidSession(context, extensionId, staleAccount);

    const popup = await context.newPage();
    await popup.goto(POPUP_URL(extensionId));
    const freshAccount = accountD;
    await seedExtensionSettings(context, extensionId, {
      userId: freshAccount.userId,
      userEmail: freshAccount.email,
      authToken: freshAccount.authToken,
    });

    await expectEventually(popup, () => isUnlocked(popup), { timeout: 30_000 });
    const settings = await readExtensionSettings(popup);
    expect(settings.userId).toBe(freshAccount.userId);
  } finally {
    await closeExtensionContext(context);
  }
});

test("AUTH_UI_14_STORAGE_CHANGE_NO_VALIDATION_LOOP identity echoes do not spin the session endpoint", async () => {
  test.setTimeout(120_000);
  const context = await launchExtensionContext();
  try {
    const extensionId = await resolveExtensionId(context);
    const account = accountD;
    await seedValidSession(context, extensionId, account);

    const sidepanel = await context.newPage();
    await sidepanel.goto(SIDEPANEL_URL(extensionId));
    await expectEventually(
      sidepanel,
      () => sidepanelWorkspaceHeader(sidepanel).first().isVisible().catch(() => false),
      { timeout: 30_000 },
    );

    const countAfterStartup = backend.sessionValidationCount();
    // Unrelated settings writes plus identity echoes over a settle window.
    await seedExtensionSettings(context, extensionId, { language: "en" });
    await sidepanel.waitForTimeout(2_000);
    await seedExtensionSettings(context, extensionId, { language: "zh" });
    await sidepanel.waitForTimeout(2_000);

    const countAfterWindow = backend.sessionValidationCount();
    // The boot validation of a second surface is tolerated (small fixed
    // number) but there must be no unbounded growth.
    expect(countAfterWindow - countAfterStartup).toBeLessThanOrEqual(3);
  } finally {
    await closeExtensionContext(context);
  }
});

test("AUTH_UI_15_PROTECTED_HANDLER_FAIL_CLOSED no runtime action dispatch while unauthenticated", async () => {
  test.setTimeout(120_000);
  const context = await launchExtensionContext();
  try {
    const extensionId = await resolveExtensionId(context);
    await installTabMessageSpy(context);
    await seedExtensionSettings(context, extensionId, {
      analyticsBaseUrl: backend.baseUrl,
      userId: "usr-gate-e2e",
      userEmail: "gate@example.com",
      authToken: FORGED_TOKEN,
    });

    const popup = await context.newPage();
    await popup.goto(POPUP_URL(extensionId));
    await expectEventually(popup, () => isAuthFormVisible(popup), { timeout: 25_000 });
    await expect(manualCaptureButton(popup)).toHaveCount(0);
    await expect(fullPageButton(popup)).toHaveCount(0);

    const sidepanel = await context.newPage();
    await sidepanel.goto(SIDEPANEL_URL(extensionId));
    await expectEventually(sidepanel, () => isAuthFormVisible(sidepanel), { timeout: 25_000 });
    // Candidates UI (detect controls) is unreachable while unauthenticated.
    await expect(sidepanel.getByRole("button", { name: /^(识别|Detect)/ })).toHaveCount(0);

    expect(await readTabMessageLog(popup)).toEqual([]);
    expect(await readTabMessageLog(sidepanel)).toEqual([]);
  } finally {
    await closeExtensionContext(context);
  }
});

// ---------------------------------------------------------------------------
// AUTH_UI_16..20 — send verification code UX contract.
// ---------------------------------------------------------------------------
async function openPopupAuthForm(
  context: Awaited<ReturnType<typeof launchExtensionContext>>,
  extensionId: string,
  baseUrl?: string,
): Promise<Page> {
  if (baseUrl) {
    await seedExtensionSettings(context, extensionId, { analyticsBaseUrl: baseUrl });
  }
  const popup = await context.newPage();
  await popup.goto(POPUP_URL(extensionId));
  await expectEventually(popup, () => isAuthFormVisible(popup), { timeout: 25_000 });
  return popup;
}

test("AUTH_UI_16_SEND_CODE_SUCCESS shows sent feedback and cooldown", async () => {
  test.setTimeout(120_000);
  const context = await launchExtensionContext();
  try {
    const extensionId = await resolveExtensionId(context);
    const popup = await openPopupAuthForm(context, extensionId, mailBackend.baseUrl);
    await popup.getByPlaceholder(/(Email|邮箱)/).fill(`auth-ui-16+${Date.now()}@example.com`);
    await popup.getByRole("button", { name: /^(Send Code|发送验证码)$/ }).click();
    await expectEventually(popup, () => popup.getByText(/验证码已发送/).first().isVisible(), { timeout: 25_000 });
    await expectEventually(
      popup,
      async () => /\d+s/.test((await popup.getByRole("button", { name: /\d+s/ }).textContent().catch(() => "")) ?? ""),
      { timeout: 5_000 },
    );
    expect(mailBackend.lastSentCode()).toBeTruthy();
  } finally {
    await closeExtensionContext(context);
  }
});

test("AUTH_UI_17_SEND_CODE_TIMEOUT hung server yields a safe timeout message", async () => {
  test.setTimeout(120_000);
  const context = await launchExtensionContext();
  const hanging = await startHangingServer();
  try {
    const extensionId = await resolveExtensionId(context);
    const popup = await openPopupAuthForm(context, extensionId, hanging.baseUrl);
    await popup.getByPlaceholder(/(Email|邮箱)/).fill(`auth-ui-17+${Date.now()}@example.com`);
    await popup.getByRole("button", { name: /^(Send Code|发送验证码)$/ }).click();
    await expect(popup.getByRole("button", { name: /(发送中|Sending)/ })).toBeVisible({ timeout: 10_000 });
    await expectEventually(
      popup,
      () => popup.getByText(/(请求超时，请稍后重试|request timed out)/i).first().isVisible(),
      { timeout: 30_000, interval: 500 },
    );
  } finally {
    await hanging.close();
    await closeExtensionContext(context);
  }
});

test("AUTH_UI_18_SEND_CODE_SMTP_UNAVAILABLE safe user-visible error without SMTP internals", async () => {
  test.setTimeout(120_000);
  const context = await launchExtensionContext();
  try {
    const extensionId = await resolveExtensionId(context);
    mailBackend.setMailerMode("fail");
    try {
      const popup = await openPopupAuthForm(context, extensionId, mailBackend.baseUrl);
      await popup.getByPlaceholder(/(Email|邮箱)/).fill(`auth-ui-18+${Date.now()}@example.com`);
      await popup.getByRole("button", { name: /^(Send Code|发送验证码)$/ }).click();
      await expectEventually(
        popup,
        () => popup.getByText(/(邮件服务暂时不可用|email service is temporarily unavailable)/i).first().isVisible(),
        { timeout: 25_000 },
      );
      const body = await popup.locator("body").innerText();
      for (const forbidden of ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS", "SMTP_FROM", "E2E_SMTP_OUTAGE"]) {
        expect(body).not.toContain(forbidden);
      }
      } finally {
        mailBackend.setMailerMode("ok");
      }
    } finally {
      await closeExtensionContext(context);
    }
  });

  test("AUTH_UI_19_SEND_CODE_RATE_LIMIT safe rate-limit feedback", async () => {
  test.setTimeout(120_000);
  const context = await launchExtensionContext();
  try {
    const extensionId = await resolveExtensionId(context);
    const email = `auth-ui-19+${Date.now()}@example.com`;
    // Burn the real per-email quota (3 per 10 minutes) against the real server.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const response = await fetch(`${mailBackend.baseUrl}/auth/send-verification-code`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      });
      expect(response.status).toBe(200);
    }
    const popup = await openPopupAuthForm(context, extensionId, mailBackend.baseUrl);
    await popup.getByPlaceholder(/(Email|邮箱)/).fill(email);
    await popup.getByRole("button", { name: /^(Send Code|发送验证码)$/ }).click();
    await expectEventually(
      popup,
      () => popup.getByText(/(验证码发送过于频繁|Too many verification codes)/i).first().isVisible(),
      { timeout: 25_000 },
    );
  } finally {
    await closeExtensionContext(context);
  }
});

test("AUTH_UI_20_SEND_CODE_NETWORK_FAILURE safe network error feedback", async () => {
  test.setTimeout(120_000);
  const context = await launchExtensionContext();
  try {
    const extensionId = await resolveExtensionId(context);
    const closedBase = await getClosedPortBaseUrl();
    const popup = await openPopupAuthForm(context, extensionId, closedBase);
    await popup.getByPlaceholder(/(Email|邮箱)/).fill(`auth-ui-20+${Date.now()}@example.com`);
    await popup.getByRole("button", { name: /^(Send Code|发送验证码)$/ }).click();
    await expectEventually(popup, () => popup.getByText(/(网络异常|Network error)/i).first().isVisible(), {
      timeout: 30_000,
      interval: 500,
    });
  } finally {
    await closeExtensionContext(context);
  }
});

test("AUTH_UI_21_SEND_CODE_FEEDBACK_NEVER_ECHOES_SECRETS feedback never contains credentials", async () => {
  test.setTimeout(120_000);
  const context = await launchExtensionContext();
  try {
    const extensionId = await resolveExtensionId(context);
    mailBackend.setMailerMode("fail");
    try {
      const popup = await openPopupAuthForm(context, extensionId, mailBackend.baseUrl);
      // Assembled at runtime: this value must never appear in UI feedback.
      const secretPassword = ["Sup3r", "Secret", "Password", Math.random().toString(36).slice(2)].join("-");
      await popup.getByPlaceholder(/(Email|邮箱)/).fill(`auth-ui-21+${Date.now()}@example.com`);
      await popup.getByPlaceholder(/(Password|密码)/).fill(secretPassword);
      await popup.getByRole("button", { name: /^(Send Code|发送验证码)$/ }).click();
      await expectEventually(
        popup,
        () => popup.getByText(/(邮件服务暂时不可用|email service is temporarily unavailable)/i).first().isVisible(),
        { timeout: 25_000 },
      );
      const body = await popup.locator("body").innerText();
      expect(body).not.toContain(secretPassword);
      expect(body).not.toContain(FORGED_TOKEN);
    } finally {
      mailBackend.setMailerMode("ok");
    }
  } finally {
    await closeExtensionContext(context);
  }
});

// ---------------------------------------------------------------------------
// AUTH_UI_25..26 — History must obey the authoritative session gate in every
// non-authenticated status (validating, server_unavailable), not just after
// an explicit logout.
// ---------------------------------------------------------------------------
async function openAuthenticatedHistoryTab(
  context: Awaited<ReturnType<typeof launchExtensionContext>>,
  extensionId: string,
  account: TestAccount,
): Promise<Page> {
  await seedValidSession(context, extensionId, account);
  const sidepanel = await context.newPage();
  await sidepanel.goto(SIDEPANEL_URL(extensionId));
  await expectEventually(sidepanel, () => sidepanelWorkspaceHeader(sidepanel).first().isVisible(), {
    timeout: 30_000,
  });
  await sidepanel.getByRole("button", { name: /^(历史|History)$/ }).click();
  // With no records the History surface renders its empty state.
  await expectEventually(
    sidepanel,
    () => sidepanel.getByText(/(还没有历史记录|No history yet)/).first().isVisible(),
    { timeout: 15_000 },
  );
  return sidepanel;
}

test("AUTH_UI_25_HISTORY_LOCKED_ON_SERVER_UNAVAILABLE history never renders while the session is unverifiable", async () => {
  test.setTimeout(120_000);
  const context = await launchExtensionContext();
  try {
    const extensionId = await resolveExtensionId(context);
    const closedBase = await getClosedPortBaseUrl();
    const sidepanel = await openAuthenticatedHistoryTab(context, extensionId, accountD);

    // Make the auth backend unreachable: the coordinator must reconcile to
    // server_unavailable and the History surface must unmount.
    await seedExtensionSettings(context, extensionId, { analyticsBaseUrl: closedBase });

    await expectEventually(
      sidepanel,
      () => sidepanel.getByText(/(暂时无法验证登录状态|Can't verify sign-in)/).first().isVisible(),
      { timeout: 30_000 },
    );
    await expectEventually(
      sidepanel,
      async () => (await sidepanel.getByText(/(还没有历史记录|No history yet)/).count()) === 0,
      { timeout: 15_000 },
    );
    expect(await sidepanel.getByRole("button", { name: /(导出 JSON|Export JSON)/ }).count()).toBe(0);
    expect(await sidepanel.getByRole("button", { name: /(清空历史|Clear History)/ }).count()).toBe(0);
  } finally {
    await closeExtensionContext(context);
  }
});

test("AUTH_UI_26_HISTORY_LOCKED_WHILE_VALIDATING history never renders during the validating window", async () => {
  test.setTimeout(120_000);
  const context = await launchExtensionContext();
  const hanging = await startHangingServer();
  try {
    const extensionId = await resolveExtensionId(context);
    const sidepanel = await openAuthenticatedHistoryTab(context, extensionId, accountD);

    // Point validation at a hung server: the surface must flip to
    // validating/locked and History must never render while the outcome is
    // undetermined.
    await seedExtensionSettings(context, extensionId, { analyticsBaseUrl: hanging.baseUrl });

    await expectEventually(
      sidepanel,
      () => sidepanel.getByText(/(正在验证登录状态|Verifying session|暂时无法验证登录状态|Can't verify sign-in)/).first().isVisible(),
      { timeout: 20_000 },
    );
    expect(await sidepanel.getByText(/(还没有历史记录|No history yet)/).count()).toBe(0);
    expect(await sidepanel.getByRole("button", { name: /(导出 JSON|Export JSON)/ }).count()).toBe(0);
    // The window stays fail-closed for as long as the server holds the
    // validation open.
    for (let check = 0; check < 6; check += 1) {
      expect(await sidepanel.getByText(/(还没有历史记录|No history yet)/).count()).toBe(0);
      await sidepanel.waitForTimeout(500);
    }
  } finally {
    await hanging.close();
    await closeExtensionContext(context);
  }
});

// ---------------------------------------------------------------------------
// AUTH_UI_34..35 — explicit logout is IMMEDIATE local fail-closed. The
// server revoke is best-effort and must never delay the local authority
// drop, nor resurrect the authenticated state when it fails.
// ---------------------------------------------------------------------------
test("AUTH_UI_34_LOGOUT_IMMEDIATE_LOCAL_FAIL_CLOSED logout drops local authority instantly even when revoke fails", async () => {
  test.setTimeout(150_000);
  const context = await launchExtensionContext();
  try {
    const extensionId = await resolveExtensionId(context);
    // A real, server-validated session first; accountD's only other uses are
    // read-only validations in earlier tests.
    await seedValidSession(context, extensionId, accountD);
    const popup = await context.newPage();
    await popup.goto(POPUP_URL(extensionId));
    const sidepanel = await context.newPage();
    await sidepanel.goto(SIDEPANEL_URL(extensionId));
    await expectEventually(popup, () => isUnlocked(popup), { timeout: 30_000 });
    // Let the identity-refresh echo of the first validation settle: an
    // in-flight saveSettings would otherwise re-write its stale
    // analyticsBaseUrl right over the unreachable-backend seed below.
    await popup.waitForTimeout(1_500);

    // Make the auth backend unreachable: the popup converges to the
    // server_unavailable gate, which exposes the logout control (the popup
    // controller has no beforeAction settings write, keeping the logout
    // fingerprint story clean).
    const closedBase = await getClosedPortBaseUrl();
    await seedExtensionSettings(context, extensionId, { analyticsBaseUrl: closedBase });
    await expectEventually(
      popup,
      () => popup.getByText(/(暂时无法验证登录状态|Can't verify sign-in)/).first().isVisible(),
      { timeout: 30_000 },
    );

    const logoutStarted = Date.now();
    await popup
      .getByRole("button", { name: /^(重置|Reset|退出登录|Logout)$/ })
      .first()
      .click({ timeout: 10_000 });

    // The local authority must drop LONG before any network timeout, and the
    // revoke result arrives instantly (connection refused = not confirmed).
    await expectEventually(popup, () => isAuthFormVisible(popup), { timeout: 5_000 });
    await expectEventually(sidepanel, () => isAuthFormVisible(sidepanel), { timeout: 10_000 });
    const settings = await readExtensionSettings(sidepanel);
    expect(!settings.userId).toBe(true);
    expect(!settings.userEmail).toBe(true);
    expect(!settings.authToken).toBe(true);
    const elapsed = Date.now() - logoutStarted;
    expect(elapsed).toBeLessThan(5_000);

    // AUTH_UI_35: the revoke could not be confirmed; the popup auth form
    // surfaces the honest hint and NEITHER surface returns to authenticated.
    await expectEventually(
      popup,
      () => popup.getByText(/(服务器会话吊销未确认|revoke couldn't be confirmed)/i).first().isVisible(),
      { timeout: 10_000 },
    );
    await expectEventually(popup, () => isAuthFormVisible(popup), { timeout: 5_000 });
    await expectEventually(sidepanel, () => isAuthFormVisible(sidepanel), { timeout: 5_000 });
  } finally {
    await closeExtensionContext(context);
  }
});
