#!/usr/bin/env node
/**
 * Phase 13B: local, user-attested, read-only browser acceptance.
 * Never use a personal Chrome profile. Never persist cookies, page text, or traces.
 */
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import readline from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { digestTree } from "./generate-rc-manifest.mjs";
import {
  createRedactedEvidence,
  examineReadOnlyObservation,
  newEphemeralKey,
  parsePhase13bArgs,
} from "./phase13b-authority.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distDir = path.join(root, "dist");
const evidenceDir = path.join(root, "test-results", "phase13b-local");
const getGit = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

async function controlState(page, secret) {
  return page.evaluate(async secretBytes => {
    const controls = Array.from(document.querySelectorAll("input,textarea,select")).map(control => ({
      tag: control.tagName,
      type: control instanceof HTMLInputElement ? control.type : "",
      name: control.getAttribute("name") ?? "",
      id: control.id,
      value: control.value,
      checked: control instanceof HTMLInputElement ? control.checked : false,
      selectedIndex: control instanceof HTMLSelectElement ? control.selectedIndex : -1,
    }));
    const key = await crypto.subtle.importKey("raw", new Uint8Array(secretBytes), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const signed = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(JSON.stringify(controls)));
    return {
      digest: Array.from(new Uint8Array(signed)).map(byte => byte.toString(16).padStart(2, "0")).join(""),
      formCount: document.forms.length,
    };
  }, Array.from(secret));
}

async function main() {
  const { site, url } = parsePhase13bArgs(process.argv.slice(2), Boolean(process.stdin.isTTY && process.stdout.isTTY));
  if (getGit("status", "--porcelain", "--untracked-files=normal") !== "") throw new Error("CLEAN_SOURCE_REQUIRED");
  const sourceSha = getGit("rev-parse", "HEAD");
  if (!/^[a-f0-9]{40}$/.test(sourceSha)) throw new Error("SOURCE_SHA_UNAVAILABLE");

  // Build exactly the currently checked-out, clean source. No remote AI provider is used.
  const runNpm = script => {
    // Windows npm is a .cmd shim; Node 24 must invoke it through cmd.exe.
    const executable = process.platform === "win32" ? "cmd.exe" : "npm";
    const args = process.platform === "win32"
      ? ["/d", "/s", "/c", `npm run ${script}`]
      : ["run", script];
    execFileSync(executable, args, { cwd: root, stdio: ["ignore", "ignore", "pipe"] });
  };
  runNpm("build");
  runNpm("verify:artifact");
  const extensionTreeSha256 = digestTree(distDir).sha256;
  const manifest = JSON.parse(await fs.readFile(path.join(distDir, "manifest.json"), "utf8"));
  const profileDir = await fs.mkdtemp(path.join(os.tmpdir(), "quiz-solver-13b-"));
  const terminal = readline.createInterface({ input: process.stdin, output: process.stdout });
  let context;

  try {
    context = await chromium.launchPersistentContext(profileDir, {
      headless: false,
      args: [`--disable-extensions-except=${distDir}`, `--load-extension=${distDir}`],
    });
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent("serviceworker", { timeout: 20_000 });

    const page = await context.newPage();
    await page.goto(url.href, { waitUntil: "commit", timeout: 45_000 });

    process.stdout.write("\n请在新打开的独立 Chrome 窗口中使用自己的合法账号完成登录，并打开需要检测的题目页面。\n");
    process.stdout.write("不会自动填答、调用 AI 或提交；浏览器结束时将删除临时登录资料。\n");
    const acknowledgement = await terminal.question("确认你有权访问该页面并同意只读检测后，输入 AUTHORIZED：");
    if (acknowledgement.trim() !== "AUTHORIZED") throw new Error("USER_AUTH_ATTESTATION_MISSING");

    await page.bringToFront();
    const urlBefore = page.url();
    const originBefore = new URL(urlBefore).origin;
    if (originBefore !== url.origin) throw new Error("TARGET_ORIGIN_MISMATCH");

    const secret = newEphemeralKey();
    const before = await controlState(page, secret);
    const monitorNonce = randomUUID();
    await page.evaluate(nonce => {
      const state = { events: [], nonce };
      Object.defineProperty(window, "__phase13bEvents", { value: state, configurable: true });
      for (const type of ["click", "input", "change", "submit"]) {
        document.addEventListener(type, event => {
          if (event.target instanceof Element && event.target.closest("qs-highlight-layer,qs-floating-window,qs-capture-overlay")) return;
          state.events.push(type);
        }, true);
      }
    }, monitorNonce);

    let blockedWrites = 0;
    await page.route("**/*", async route => {
      if (!["GET", "HEAD", "OPTIONS"].includes(route.request().method().toUpperCase())) {
        blockedWrites += 1;
        await route.abort("blockedbyclient");
      } else {
        await route.continue();
      }
    });

    const tabId = await worker.evaluate(async expected => {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const tab = tabs.find(t => t.id && t.url && new URL(t.url).origin === expected);
      return tab?.id ?? null;
    }, originBefore);
    if (!tabId) throw new Error("ACTIVE_AUTHORIZED_TAB_UNAVAILABLE");
    await worker.evaluate(async id => {
      await chrome.scripting.executeScript({ target: { tabId: id }, files: ["content/content-main.js"] });
    }, tabId);
    const started = await worker.evaluate(async id => {
      return await chrome.tabs.sendMessage(id, { type: "START_AUTO_DETECT" });
    }, tabId);
    if (!started?.ok) throw new Error("DETECTION_START_REJECTED");

    let snapshot;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const result = await worker.evaluate(async ({ id, expectedUrl }) => {
        return await chrome.tabs.sendMessage(id, { type: "GET_CANDIDATE_WORKSPACE_SNAPSHOT", expectedUrl });
      }, { id: tabId, expectedUrl: urlBefore });
      if (result?.ok && result.snapshot?.detection?.phase === "completed") {
        snapshot = result.snapshot;
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 250));
    }

    const after = await controlState(page, secret);
    const monitor = await page.evaluate(nonce => ({
      alive: window.__phase13bEvents?.nonce === nonce,
      events: window.__phase13bEvents?.events ?? [],
    }), monitorNonce);
    const observation = {
      site,
      sourceSha,
      extensionVersion: manifest.version,
      extensionTreeSha256,
      userAttested: true,
      originBefore,
      originAfter: new URL(page.url()).origin,
      urlBefore,
      urlAfter: page.url(),
      snapshot,
      monitorAlive: monitor.alive,
      events: monitor.events,
      blockedWrites,
      formCountBefore: before.formCount,
      formCountAfter: after.formCount,
      digestBefore: before.digest,
      digestAfter: after.digest,
    };
    const failureCode = examineReadOnlyObservation(observation);
    const evidence = createRedactedEvidence(observation, failureCode);
    await fs.mkdir(evidenceDir, { recursive: true });
    const evidencePath = path.join(evidenceDir, `phase13b-${site}-${randomUUID()}.json`);
    await fs.writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600, flag: "wx" });

    process.stdout.write(`\nPHASE13B_${failureCode ? "FAIL" : "LOCAL_READONLY_PASS"}\n`);
    process.stdout.write(`脱敏证据（仅保存在本机）：${evidencePath}\n`);
    if (failureCode) throw new Error(failureCode);
  } finally {
    terminal.close();
    try { await context?.close(); } finally { await fs.rm(profileDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); }
  }
}

main().catch(error => {
  // Error messages from a live page, browser or transport can contain private content.
  // Only print known local error codes; never dump an upstream stack or URL.
  const allowedCodes = new Set([
    "INTERACTIVE_TERMINAL_REQUIRED", "DUPLICATE_ARGUMENT", "UNKNOWN_ARGUMENT",
    "MISSING_ARGUMENT_VALUE", "EXPLICIT_CONSENT_REQUIRED", "UNSUPPORTED_SITE_IDENTIFIER",
    "TARGET_URL_REQUIRED", "INVALID_TARGET_URL", "HTTPS_TARGET_REQUIRED",
    "PUBLIC_HTTPS_DOMAIN_REQUIRED", "ORIGIN_ONLY_REQUIRED", "SITE_ORIGIN_MISMATCH", "CLEAN_SOURCE_REQUIRED",
    "SOURCE_SHA_UNAVAILABLE", "USER_AUTH_ATTESTATION_MISSING", "TARGET_ORIGIN_MISMATCH",
    "ACTIVE_AUTHORIZED_TAB_UNAVAILABLE", "DETECTION_START_REJECTED",
    "WORKSPACE_ORIGIN_MISMATCH", "DETECTION_NOT_COMPLETE", "NO_CANDIDATE_DETECTED",
    "PAGE_INTERACTION_OBSERVED", "NETWORK_WRITE_ATTEMPTED", "PAGE_FORM_STRUCTURE_CHANGED",
    "PAGE_CONTROL_STATE_CHANGED", "ORIGIN_CHANGED", "ROUTE_CHANGED",
  ]);
  const safeCode = allowedCodes.has(error?.message) ? error.message : "LOCAL_ACCEPTANCE_ERROR";
  process.stderr.write(`PHASE13B_FAIL: ${safeCode}\n`);
  process.exitCode = 1;
});
