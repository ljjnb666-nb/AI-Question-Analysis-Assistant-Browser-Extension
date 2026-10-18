/**
 * LOCAL EDGE TEST ONLY.
 * This script mutates an ephemeral checkout, never the default branch.
 * It provides a UI-only simulated session and never creates an auth token.
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const expectedBranch = "refs/heads/test/local-edge-nologin-20261018-r1";
const localTag = "LOCAL_EDGE_NO_LOGIN_BUILD";
const requiredOptIn = "LOCAL_EDGE_UI_ONLY_I_ACKNOWLEDGE";
const localName = "题目解析助手【本地免登录测试·禁止发布】";

function assertAllowed() {
  if (process.env.QUIZ_SOLVER_LOCAL_EDGE_BUILD !== requiredOptIn) {
    throw new Error("LOCAL_EDGE_BUILD_REQUIRES_EXPLICIT_OPT_IN");
  }
  if (process.env.GITHUB_ACTIONS === "true" && process.env.GITHUB_REF !== expectedBranch) {
    throw new Error("LOCAL_EDGE_BUILD_REF_FORBIDDEN");
  }
}

function read(relative) {
  return readFileSync(path.join(root, relative), "utf8");
}

function write(relative, text) {
  writeFileSync(path.join(root, relative), text, "utf8");
}

function walkFiles(dir) {
  if (!existsSync(dir)) return [];
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walkFiles(file));
    else if (entry.isFile()) files.push(file);
  }
  return files;
}

function verify() {
  const dist = path.join(root, "dist");
  const manifest = JSON.parse(read("dist/manifest.json"));
  if (manifest.name !== localName || !manifest.version_name?.includes("LOCAL-NO-LOGIN")) {
    throw new Error("LOCAL_EDGE_DIST_MANIFEST_NOT_MARKED");
  }
  const js = walkFiles(dist)
    .filter((file) => file.endsWith(".js"))
    .map((file) => readFileSync(file, "utf8")).join("\n");
  if (!js.includes(localTag)) {
    throw new Error("LOCAL_EDGE_DIST_SESSION_MARKER_MISSING");
  }
  if (!js.includes("本地免登录测试")) {
    throw new Error("LOCAL_EDGE_DIST_BANNER_MISSING");
  }
  console.log("LOCAL_EDGE_TEST_ARTIFACT_VERIFIED: UI mock session only; not a backend credential");
}

assertAllowed();

if (process.argv.includes("--verify")) {
  verify();
} else {
  // Replace only the UI hook in this temporary Actions checkout.
  // The production source in the Git branch and main stay unchanged.
  const authPath = "src/shared/auth/useAuthSession.ts";
  const originalAuth = read(authPath);
  if (!originalAuth.includes("createAuthSessionCoordinator") ||
      !originalAuth.includes("validateAuthSession") ||
      originalAuth.includes(localTag)) {
    throw new Error("LOCAL_EDGE_AUTH_SOURCE_PRECONDITION_FAILED");
  }
  write(authPath, [
    'import { useState } from "react";',
    'import type { AuthSessionCoordinator, AuthSessionState } from "./authSessionCoordinator";',
    'const state: AuthSessionState = {',
    '  status: "authenticated",',
    '  userId: "local-edge-ui-only",',
    '  userEmail: "本地免登录测试 · ' + localTag + '",',
    '  sessionRejected: false,',
    '};',
    '// Test-only simulated UI session; never creates a server auth token.',
    'export function useAuthSession(): AuthSessionCoordinator {',
    '  const [session] = useState<AuthSessionCoordinator>(() => ({',
    '    getState: () => state,',
    '    subscribe: () => () => {},',
    '    start: () => {},',
    '    dispose: () => {},',
    '    bootstrap: async () => {},',
    '    retryValidation: async () => {},',
    '    handleStorageChanged: () => {},',
    '    applyAuthenticatedSession: async () => {},',
    '    applyLoggedOut: () => {},',
    '  }));',
    '  return session;',
    '}',
    '',
  ].join("\n"));

  const banner = '      <div role="alert" style={{ padding: "8px 12px", background: "#fff0be", color: "#5f3700", borderBottom: "1px solid #db9d28", fontSize: 12, fontWeight: 700 }}>⚠ 本地免登录测试版（无真实账号会话，禁止发布）</div>';
  for (const [file, marker] of [
    ["src/popup/PopupApp.tsx", "    <div style={shellStyle}>"],
    ["src/sidepanel/SidePanelApp.tsx", "    <div style={APP_SHELL_STYLE}>"],
  ]) {
    const source = read(file);
    if (source.split(marker).length !== 2) {
      throw new Error("LOCAL_EDGE_UI_MARKER_PRECONDITION_FAILED: " + file);
    }
    write(file, source.replace(marker, marker + "\n" + banner));
  }

  const manifest = JSON.parse(read("src/manifest.json"));
  if (manifest.manifest_version !== 3) {
    throw new Error("LOCAL_EDGE_MANIFEST_PRECONDITION_FAILED");
  }
  manifest.name = localName;
  manifest.description = "仅限本地 Edge 题目识别验收。模拟前端会话，不提供真实登录令牌；禁止发布。";
  manifest.version_name = String(manifest.version) + "-LOCAL-NO-LOGIN";
  write("src/manifest.json", JSON.stringify(manifest, null, 2) + "\n");
  console.log("LOCAL_EDGE_TEST_SOURCE_PREPARED: source changed only in the ephemeral checkout");
}
