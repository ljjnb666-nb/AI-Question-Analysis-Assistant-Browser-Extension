/**
 * Phase 14A: repeat the *entire* Popup UI-02 test file in fresh processes.
 *
 * The historical failure was UI02-C04 after earlier Popup integration cases.
 * Repeating only C04 would miss inter-test async contamination.
 * Every iteration must pass; there are no retries or tolerated failures.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runner = path.join(repoRoot, "node_modules", "vitest", "vitest.mjs");
const iterations = 20;

for (let iteration = 1; iteration <= iterations; iteration += 1) {
  const start = process.hrtime.bigint();
  const child = spawnSync(process.execPath, [
    "--disable-warning=ExperimentalWarning",
    runner,
    "run",
    "src/popup/popup.ui02.test.tsx",
  ], {
    cwd: repoRoot,
    encoding: "utf8",
    timeout: 60_000,
    maxBuffer: 4 * 1024 * 1024,
    env: { ...process.env, CI: "true" },
  });
  const elapsed = Math.round(Number(process.hrtime.bigint() - start) / 1_000_000);
  if (child.error || child.signal || child.status !== 0) {
    // Emit the failing test names and diagnostics, but do not paper over the
    // failure with a retry. CI should remain red on any single iteration.
    const output = [child.stdout ?? "", child.stderr ?? ""].join("\n");
    process.stderr.write(`PHASE14A_POPUP_SOAK_FAIL iteration=${iteration}/${iterations} elapsedMs=${elapsed} status=${child.status ?? "unknown"} signal=${child.signal ?? "none"}\n`);
    process.stderr.write(`${output.slice(-12000)}\n`);
    process.exitCode = 1;
    break;
  }
  const count = /50 passed/.test(child.stdout ?? "");
  if (!count) {
    process.stderr.write(`PHASE14A_POPUP_SOAK_UNEXPECTED_TEST_COUNT iteration=${iteration} (expected 50 passing tests)\n`);
    process.exitCode = 1;
    break;
  }
  process.stdout.write(`PHASE14A_POPUP_SOAK_PASS iteration=${iteration}/${iterations} tests=50 elapsedMs=${elapsed}\n`);
}
if (process.exitCode !== 1) {
  process.stdout.write(`PHASE14A_POPUP_SOAK_COMPLETE iterations=${iterations} tests=1000 failures=0\n`);
}
