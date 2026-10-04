import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("E2B2A production authority contract", () => {
  it("PRODUCTION_SOLVE_COMPAT_IMPORTS = 0 and the compatibility module is deleted", () => {
    const root = resolve("src");
    const files = readdirSync(root, { recursive: true }).filter(name => /\.(?:ts|tsx)$/.test(String(name)) && !String(name).includes(".test."));
    const references = files.filter(name => /legacyRuntimeSettingsCompat|loadLegacyRuntimeSettingsCompat/.test(readFileSync(resolve(root, String(name)), "utf8")));
    expect(references).toEqual([]);
    expect(existsSync(resolve(root, "shared/utils/legacyRuntimeSettingsCompat.ts"))).toBe(false);
  });
  it("parser and wire clients never read compatibility-shaped AI settings", () => {
    for (const file of ["src/shared/utils/parseRouter.ts", "src/shared/ai/providerClients.ts", "src/shared/ai/routeDecision.ts"]) {
      const source = readFileSync(resolve(file), "utf8");
      expect(source).not.toMatch(/settings\.(?:providerId|apiKey|apiModel|customBaseUrl|customProviderProtocol)\b/);
    }
  });
});
