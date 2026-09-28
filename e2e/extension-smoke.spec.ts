import { expect, test } from "@playwright/test";
import { closeExtensionContext, launchExtensionContext, resolveExtensionId } from "./helpers/extensionHarness";

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
    await closeExtensionContext(context);
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
    await closeExtensionContext(context);
  }
});
