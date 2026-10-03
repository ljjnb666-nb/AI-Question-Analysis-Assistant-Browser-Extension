/** Test-only component fixture for UI-05 visual evidence. No production secrets or network calls. */
import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { SettingsTab } from "../../src/sidepanel/settingsPanel";
import { APP_SHELL_STYLE, PANEL_BODY_STYLE, SidePanelHeader, WorkspaceTabPanel } from "../../src/sidepanel/sidePanelShell";
import { ORBIT_SCROLLBAR_CSS } from "../../src/sidepanel/orbitScrollbar";
import type { UILang } from "../../src/sidepanel/displayUtils";

const params = new URLSearchParams(location.search);
const lang: UILang = params.get("lang") === "en" ? "en" : "zh";
const state = params.get("state") || "first-run";

// Synthetic test key strictly for UI05 evidence
const SYNTHETIC_KEY = "sk-test-ui05-example";

const initialStore: Record<string, unknown> = {
  appSettings: {
    language: lang,
    deviceId: "dev-ui05-fixture",
    providerId: state === "ollama" ? "ollama" : state === "custom" ? "custom" : "anthropic",
    apiKey:
      state === "first-run" || state === "provider-picker"
        ? ""
        : state === "ollama"
          ? ""
          : SYNTHETIC_KEY,
    apiModel:
      state === "ollama"
        ? "qwen3-vl"
        : state === "custom"
          ? "gpt-5.4-mini"
          : "claude-opus-4.8",
    preferredRoute: "auto",
    customBaseUrl: state === "custom" ? "https://api.my-custom-proxy.internal/v1" : "",
    customProviderProtocol: "openai",
    enableAnalytics: false,
  },
};

const event = { addListener: () => {}, removeListener: () => {} };
Object.assign(globalThis, {
  chrome: {
    storage: {
      onChanged: event,
      local: {
        get: async (key: string) => ({ [key]: initialStore[key] }),
        set: async (values: Record<string, unknown>) => Object.assign(initialStore, values),
        remove: async () => {},
      },
    },
    runtime: {
      onMessage: event,
      getManifest: () => ({ version: "0.2.0" }),
      sendMessage: async () => undefined,
    },
    tabs: {},
  },
});

const originalFetch = window.fetch.bind(window);
window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : (input as Request).url;
  if (url.includes("/messages") || url.includes("/chat/completions") || url.includes("internal/v1")) {
    if (state === "validation-testing") {
      return new Promise(() => {}); // never resolves
    }
    if (state === "validation-error") {
      return new Response(JSON.stringify({ error: { message: "Invalid API Key" } }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(
      JSON.stringify({
        content: [
          {
            type: "text",
            text: JSON.stringify({
              answer: "B",
              confidence: 0.98,
              brief_explanation: "Option B is correct.",
              detailed_explanation: "Option B is correct.",
            }),
          },
        ],
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
  return originalFetch(input, init);
};

function Fixture() {
  const [uiLang, setUiLang] = useState<UILang>(lang);

  useEffect(() => {
    document.documentElement.lang = uiLang === "en" ? "en" : "zh-CN";

    const runStateAction = async () => {
      await new Promise((r) => setTimeout(r, 120));

      if (state === "api-key-visible-synthetic") {
        const toggle = document.querySelector('button[aria-label*="API Key"]') as HTMLButtonElement;
        if (toggle) toggle.click();
      } else if (state === "config-saved-not-tested") {
        const saveBtn = Array.from(document.querySelectorAll("button")).find(
          (b) => b.textContent?.includes("保存设置") || b.textContent?.includes("Save Settings"),
        );
        if (saveBtn) saveBtn.click();
      } else if (state === "validation-testing" || state === "validation-success" || state === "ready" || state === "validation-error") {
        const testBtn = document.querySelector('button[aria-label*="测试配置"], button[aria-label*="Test"]') as HTMLButtonElement;
        if (testBtn) testBtn.click();
      }
    };
    void runStateAction();
  }, [uiLang]);

  return (
    <div style={APP_SHELL_STYLE}>
      <style>{ORBIT_SCROLLBAR_CSS}</style>
      <SidePanelHeader
        lang={uiLang}
        authStatus="authenticated"
        isAuthenticated={true}
        userEmail="operator@example.test"
        tab="settings"
        onTabChange={() => {}}
        workspaceStatus="ready"
        providerName={state === "ollama" ? "Ollama" : state === "custom" ? "Custom" : "Claude"}
        onToggleLanguage={() => setUiLang(uiLang === "zh" ? "en" : "zh")}
      />
      <div className="orbit-panel-scroll" style={PANEL_BODY_STYLE}>
        <WorkspaceTabPanel id="sidepanel-tabpanel-settings" tabId="settings">
          <SettingsTab lang={uiLang} onLanguageChange={setUiLang} />
        </WorkspaceTabPanel>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<Fixture />);
