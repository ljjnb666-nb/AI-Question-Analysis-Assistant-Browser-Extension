import { test, expect, type Page } from "@playwright/test";
import { createServer, type ViteDevServer } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import fs from "node:fs/promises";

let server: ViteDevServer;
test.use({ headless: false });
let origin: string;
const evidence = path.resolve("docs/evidence/ui04");
test.beforeAll(async () => {
  server = await createServer({ configFile: false, plugins: [react()], resolve: { alias: { "@": path.resolve("src") } }, server: { host: "127.0.0.1", port: 0 } });
  await server.listen(); origin = server.resolvedUrls!.local[0]; await fs.mkdir(evidence, { recursive: true });
});
test.afterAll(async () => { await server?.close(); });

async function open(page: Page, mode = "candidates", lang = "zh", width = 360) {
  await page.setViewportSize({ width, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(`${origin}e2e/fixtures/ui04.html?mode=${mode}&lang=${lang}`);
  await expect(page.getByRole("tab", { name: lang === "en" ? "Candidates" : "候选题" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", lang === "en" ? "en" : "zh-CN");
}
async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await page.locator(".orbit-panel-scroll").evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
}
async function capture(page: Page, name: string) {
  await noOverflow(page);
  await page.evaluate(async () => { await document.fonts.ready; await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))); });
  await page.screenshot({ path: path.join(evidence, name), animations: "disabled" });
}

test("UI04-25/26: 320/360/400/480px remain operable without horizontal overflow", async ({ page }) => {
  for (const width of [320, 360, 400, 480]) {
    await open(page, "long", "zh", width);
    await expect(page.getByRole("article")).toHaveCount(1);
    await page.getByRole("button", { name: "展开完整题干" }).click();
    await expect(page.getByRole("button", { name: "收起题干" })).toHaveAttribute("aria-expanded", "true");
    await noOverflow(page);
    await page.getByRole("button", { name: "收起题干" }).click();
    await expect(page.getByRole("region", { name: "答案" })).toContainText("完整答案");
    await noOverflow(page);
    await expect(page.getByRole("button", { name: "待解析", exact: true })).toBeVisible();
    if (width === 320) await capture(page, "sidepanel-ui04-320px.png");
  }
});
test("UI04-18/19: Space selects the native checkbox and focus does not bubble", async ({ page }) => {
  await open(page, "candidates", "en");
  const checkbox = page.getByRole("checkbox", { name: "Select question 3" });
  await page.keyboard.press("Tab"); await checkbox.focus(); await page.keyboard.press("Space"); await expect(checkbox).toBeChecked();
  expect(await checkbox.evaluate(node => getComputedStyle(node).outlineStyle)).toBe("solid");
  expect(await page.getByRole("article", { name: "Question 3" }).evaluate(node => getComputedStyle(node).outlineStyle)).toBe("none");
  await page.getByRole("button", { name: "Selected", exact: true }).click();
  await expect(page.getByRole("article", { name: "Question 3" })).toBeVisible();
});
test("UI04-24: available image segments load actual image pixels, including multiple images", async ({ page }) => {
  await open(page, "image", "en");
  const images = page.getByRole("img", { name: "Question figure" });
  await expect(images).toHaveCount(2);
  await expect.poll(() => images.evaluateAll(nodes => nodes.every(node => (node as HTMLImageElement).complete && (node as HTMLImageElement).naturalWidth === 240))).toBe(true);
  await expect(page.getByText(/preview is unavailable/)).toHaveCount(0);
  await noOverflow(page);
});
test("RF01 feedback: 360px ZH/EN outcomes remain visible beside authoritative progress", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  for (const lang of ["zh", "en"]) {
    await open(page, "feedback-success", lang);
    await expect(page.getByTestId("workspace-user-feedback")).toContainText(lang === "en" ? "Fill completed" : "填写完成");
    await expect(page.getByRole("button", { name: lang === "en" ? "Fill selected" : "填写所选" })).toBeVisible();
    await expect(page.getByTestId("workspace-activity-strip")).toHaveCount(0);
    await noOverflow(page);
    if (lang === "zh") await capture(page, "sidepanel-ui04-feedback-success.png");
    await open(page, "feedback-warning", lang);
    await expect(page.getByTestId("workspace-user-feedback")).toContainText(lang === "en" ? "re-parsed" : "重新解析");
    await expect(page.getByTestId("workspace-activity-strip")).toContainText(lang === "en" ? "Question 3 / 3" : "第 3 / 3 题");
    await expect(page.getByRole("button", { name: lang === "en" ? "Stop Solve & Fill" : "停止解析并填答" })).toBeVisible();
    await noOverflow(page);
    if (lang === "en") await capture(page, "sidepanel-ui04-feedback-warning.png");
    await open(page, "feedback-review", lang);
    await expect(page.getByTestId("workspace-user-feedback")).toHaveCount(0);
    await expect(page.getByTestId("workspace-activity-strip")).toBeVisible();
  }
  expect(errors).toEqual([]);
});
test("UI04 visual evidence: asserted empty, mixed, selected, review, running, long and Settings", async ({ page }) => {
  await open(page, "empty"); await expect(page.getByRole("article")).toHaveCount(0); await expect(page.getByText(/先用/)).toBeVisible(); await capture(page, "sidepanel-ui04-zh-empty.png");
  for (const lang of ["zh", "en"]) {
    await open(page, "candidates", lang); await expect(page.getByRole("article")).toHaveCount(3);
    await expect(page.locator('[data-candidate-status="review"]')).toHaveCount(1); await expect(page.locator("dl dd")).toHaveText(["3", "1", "2", "1"]);
    await page.setViewportSize({ width: 360, height: 2000 });
    await expect(page.getByText("Which value equals 2 + 2?", { exact: true })).toBeVisible();
    await capture(page, `sidepanel-ui04-${lang}-candidates.png`);
    await open(page, "running", lang); await expect(page.locator('[data-active="true"]')).toHaveCount(1);
    await expect(page.getByTestId("workspace-activity-strip")).toContainText(lang === "en" ? "Question 3 / 3" : "第 3 / 3 题");
    await expect(page.getByRole("button", { name: lang === "en" ? "Stop Solve & Fill" : "停止解析并填答" })).toBeEnabled();
    await page.locator('[data-active="true"]').scrollIntoViewIfNeeded();
    await expect(page.getByText("Choose the correct statement.", { exact: true })).toBeVisible();
    await capture(page, `sidepanel-ui04-${lang}-running.png`);
  }
  await open(page, "selected"); await expect(page.getByRole("article")).toHaveCount(1); await expect(page.getByRole("checkbox")).toBeChecked(); await capture(page, "sidepanel-ui04-zh-selected.png");
  await open(page, "review"); await expect(page.getByRole("article")).toHaveCount(1); await expect(page.getByText(/答案置信度较低/)).toBeVisible(); await capture(page, "sidepanel-ui04-zh-review-required.png");
  await open(page, "long"); await expect(page.getByRole("region", { name: "答案" })).toContainText("完整答案"); await capture(page, "sidepanel-ui04-zh-long-content.png");
  await open(page, "settings"); await expect(page.getByRole("tabpanel")).toBeVisible();
  await expect(page.getByRole("tab", { name: "设置", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByText("服务商", { exact: true })).toBeVisible();
  await expect(page.getByPlaceholder("sk-test-ui03-example")).toBeVisible();
  expect(await page.locator(".orbit-panel-scroll").evaluate(node => node.scrollHeight > node.clientHeight)).toBe(true);
  await expect(page.locator(".orbit-panel-scroll")).toHaveCSS("scrollbar-width", "thin"); await capture(page, "sidepanel-ui04-settings-scrollbar.png");
});
