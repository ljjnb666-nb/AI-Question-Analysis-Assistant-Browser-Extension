/** Test-only component fixture for UI-05 visual evidence. No production secrets or network calls. */
import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { SettingsTab, type SettingsView } from "../../src/sidepanel/settingsPanel";
import { APP_SHELL_STYLE, PANEL_BODY_STYLE, SidePanelHeader, WorkspaceTabPanel } from "../../src/sidepanel/sidePanelShell";
import { ORBIT_SCROLLBAR_CSS } from "../../src/sidepanel/orbitScrollbar";
import type { UILang } from "../../src/sidepanel/displayUtils";
import { encryptValue } from "../../src/shared/utils/encryption";
import { resolvePresetAuthScheme } from "../../src/shared/utils/aiConnectionPresets";
import type { ProviderPresetId } from "../../src/shared/types/connection";

const params = new URLSearchParams(location.search);
const lang: UILang = params.get("lang") === "en" ? "en" : "zh";
const state = params.get("state") || "first-run";

// Synthetic test key strictly for UI05 evidence
const SYNTHETIC_KEY = "sk-test-ui05-example";

const isConfigured = state !== "first-run" && state !== "provider-picker";
const hasKey = isConfigured && state !== "ollama";

const initialView: SettingsView =
  state === "provider-picker"
    ? "catalog"
    : state === "api-key-hidden" ||
      state === "api-key-visible-synthetic" ||
      state === "config-saved-not-tested" ||
      state === "validation-testing" ||
      state === "validation-error" ||
      state === "validation-success" ||
      state === "ollama" ||
      state === "custom"
      ? "editor"
      : "home";

const initialStore: Record<string, unknown> = {};

const event = { addListener: () => {}, removeListener: () => {} };
Object.assign(globalThis, {
  chrome: {
    storage: {
      onChanged: event,
      local: {
        get: async (key: string | string[] | Record<string, unknown> | null) => {
          if (typeof key === "string") return { [key]: initialStore[key] };
          if (Array.isArray(key)) {
            const res: Record<string, unknown> = {};
            for (const k of key) res[k] = initialStore[k];
            return res;
          }
          return { ...initialStore };
        },
        set: async (values: Record<string, unknown>) => {
          Object.assign(initialStore, values);
        },
        remove: async () => {},
      },
    },
    runtime: {
      id: "ui05-test-extension",
      onMessage: event,
      getManifest: () => ({ version: "0.2.0" }),
      sendMessage: async (msg: any) => {
        if (!msg || typeof msg !== "object") return undefined;
        if (msg.type === "AI_CONNECTION_ENSURE_INITIALIZED") {
          return { ok: true };
        }
        if (msg.type === "AI_CONNECTION_GET_EDITOR_VIEW") {
          const connState = initialStore.aiConnectionState as any;
          const activeConn = connState?.connections?.[connState.activeConnectionId];
          const hasCredential = Boolean(
            activeConn?.credentialRef && connState.credentials?.[activeConn.credentialRef],
          );
          return {
            ok: true,
            editorView: {
              presetId: activeConn?.presetId ?? "anthropic",
              selectedModelId: activeConn?.selectedModelId ?? "claude-opus-4.8",
              endpointOverride: activeConn?.endpointOverride ?? null,
              protocol:
                activeConn?.protocolOverride ??
                (activeConn?.presetId === "anthropic" ? "anthropic_messages" : "openai_chat_completions"),
              hasCredential,
            },
          };
        }
        if (msg.type === "AI_CONNECTION_GET_ACTIVE_METADATA") {
          const connState = initialStore.aiConnectionState as any;
          const activeConn = connState?.connections?.[connState.activeConnectionId];
          const hasCredential = Boolean(
            activeConn?.credentialRef && connState.credentials?.[activeConn.credentialRef],
          );
          return {
            ok: true,
            metadata: {
              id: activeConn?.id ?? "fixture-conn",
              name: activeConn?.name ?? "fixture",
              presetId: activeConn?.presetId ?? "anthropic",
              providerId: activeConn?.presetId ?? "anthropic",
              selectedModelId: activeConn?.selectedModelId ?? "claude-opus-4.8",
              endpointOverride: activeConn?.endpointOverride ?? null,
              protocol: activeConn?.protocolOverride ?? "anthropic_messages",
              authScheme: activeConn?.authScheme ?? "api_key",
              connectionRevision: activeConn?.connectionRevision ?? 1,
              credentialRevision: hasCredential ? 1 : 0,
              hasCredential,
              validation: activeConn?.validation ?? { status: "untested" },
            },
          };
        }
        if (msg.type === "AI_CONNECTION_UPDATE_ACTIVE") {
          const patch = msg.patch;
          const connState = initialStore.aiConnectionState as any;
          const activeConn = connState?.connections?.[connState.activeConnectionId];
          if (activeConn) {
            const presetId = (patch.presetId ?? activeConn.presetId) as ProviderPresetId;
            activeConn.presetId = presetId;
            if (presetId === "custom") {
              activeConn.endpointOverride = patch.endpointOverride || undefined;
              activeConn.protocolOverride =
                patch.protocolOverride === "anthropic_messages"
                  ? "anthropic_messages"
                  : "openai_chat_completions";
            } else {
              activeConn.endpointOverride = undefined;
              activeConn.protocolOverride = undefined;
            }
            if (patch.selectedModelId) activeConn.selectedModelId = patch.selectedModelId;
            activeConn.authScheme = resolvePresetAuthScheme(
              presetId,
              activeConn.protocolOverride,
            );
            if (patch.credential) {
              if (patch.credential.action === "REPLACE" && patch.credential.value) {
                const enc = await encryptValue(patch.credential.value);
                connState.credentials = connState.credentials || {};
                connState.credentials["credential"] = {
                  ref: "credential",
                  type: "api_key",
                  encryptedValue: enc,
                  revision: (connState.credentials["credential"]?.revision ?? 0) + 1,
                  updatedAt: Date.now(),
                };
                activeConn.credentialRef = "credential";
              } else if (patch.credential.action === "CLEAR") {
                if (activeConn.credentialRef) delete connState.credentials?.[activeConn.credentialRef];
                activeConn.credentialRef = undefined;
              }
            }
          }
          const hasCredential = Boolean(
            activeConn?.credentialRef && connState.credentials?.[activeConn.credentialRef],
          );
          return { ok: true, metadata: { hasCredential } };
        }
        if (msg.type?.startsWith("APP_SETTINGS_")) {
          if (msg.type === "APP_SETTINGS_UPDATE" && msg.patch) {
            Object.assign(initialStore.appSettings as any, msg.patch);
          }
          return { ok: true, deviceId: "dev-ui05-fixture", analyticsDisabled: true };
        }
        return { ok: true };
      },
    },
    tabs: {},
  },
});

const originalFetch = window.fetch.bind(window);
window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : (input as Request).url;
  if (url.includes("/auth/session") || url.includes("/user/profile")) {
    if (state === "first-run") {
      return new Response(JSON.stringify({ error: { message: "Unauthorized" } }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(
      JSON.stringify({
        ok: true,
        user: {
          userId: "usr-ui05-operator",
          email: "operator@example.test",
        },
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  if (url.includes("/messages") || url.includes("/chat/completions") || url.includes("internal/v1") || url.includes("anthropic.com") || url.includes("openai.com")) {
    if (state === "validation-testing") {
      return new Promise(() => {}); // never resolves
    }
    if (state === "validation-error") {
      return new Response(JSON.stringify({ error: { message: "Invalid API Key" } }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }
    const sampleAnswer = JSON.stringify({
      answer: "B",
      confidence: 0.98,
      brief_explanation: "Option B is correct.",
      detailed_explanation: "Option B is correct.",
    });
    return new Response(
      JSON.stringify({
        content: [
          {
            type: "text",
            text: sampleAnswer,
          },
        ],
        choices: [
          {
            message: {
              content: sampleAnswer,
            },
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
      // Allow react hydration to settle
      await new Promise((r) => requestAnimationFrame(r));

      if (state === "api-key-visible-synthetic") {
        const toggle = document.querySelector('button[aria-label*="API Key"]') as HTMLButtonElement;
        if (toggle) toggle.click();
      } else if (state === "config-saved-not-tested") {
        const saveBtn = Array.from(document.querySelectorAll("button")).find(
          (b) => b.textContent?.includes("保存设置") || b.textContent?.includes("Save Settings"),
        );
        if (saveBtn) saveBtn.click();
      }
    };
    void runStateAction();
  }, [uiLang]);

  const isAuth = state !== "first-run";

  return (
    <div style={APP_SHELL_STYLE}>
      <style>{ORBIT_SCROLLBAR_CSS}</style>
      <SidePanelHeader
        lang={uiLang}
        authStatus={isAuth ? "authenticated" : "unauthenticated"}
        isAuthenticated={isAuth}
        userEmail={isAuth ? "operator@example.test" : ""}
        tab="settings"
        onTabChange={() => {}}
        workspaceStatus={state === "ready" ? "ready" : "unconfigured"}
        providerName={state === "ollama" ? "Ollama" : state === "custom" ? "Custom" : "Claude"}
        onToggleLanguage={() => setUiLang(uiLang === "zh" ? "en" : "zh")}
      />
      <div className="orbit-panel-scroll" style={PANEL_BODY_STYLE}>
        <WorkspaceTabPanel id="sidepanel-tabpanel-settings" tabId="settings">
          <SettingsTab lang={uiLang} onLanguageChange={setUiLang} initialView={initialView} authOnly={!isAuth} />
        </WorkspaceTabPanel>
      </div>
    </div>
  );
}

async function initAndMount() {
  const presetId: ProviderPresetId = state === "ollama" ? "ollama" : state === "custom" ? "custom" : "anthropic";
  const protocolOverride = state === "custom" ? "openai_chat_completions" : undefined;
  const authScheme = resolvePresetAuthScheme(presetId, protocolOverride);
  const encryptedKey = await encryptValue(SYNTHETIC_KEY);
  const isAuth = state !== "first-run";

  Object.assign(initialStore, {
    appSettings: {
      language: lang,
      deviceId: "dev-ui05-fixture",
      preferredRoute: "auto",
      enableAnalytics: false,
      userId: isAuth ? "usr-ui05-operator" : undefined,
      userEmail: isAuth ? "operator@example.test" : undefined,
      authToken: isAuth ? "tok-ui05-operator" : undefined,
    },
    aiConnectionState: {
      schemaVersion: 1,
      revision: 1,
      activeConnectionId: "fixture-conn",
      connections: {
        "fixture-conn": {
          id: "fixture-conn",
          name: "fixture",
          presetId,
          protocolOverride,
          endpointOverride: state === "custom" ? "https://api.my-custom-proxy.internal/v1" : undefined,
          selectedModelId:
            state === "ollama"
              ? "qwen3-vl"
              : state === "custom"
                ? "gpt-5.4-mini"
                : "claude-opus-4.8",
          authScheme,
          credentialRef: hasKey ? "credential" : undefined,
          connectionRevision: 1,
          validation:
            state === "ready"
              ? {
                  status: "validated",
                  generation: 1,
                  validatedConnectionRevision: 1,
                  validatedCredentialRevision: 1,
                }
              : { status: "never_tested", generation: 0 },
          createdAt: 1,
          updatedAt: 1,
        },
      },
      credentials: hasKey
        ? {
            credential: {
              ref: "credential",
              type: "api_key",
              encryptedValue: encryptedKey,
              revision: 1,
              updatedAt: 1,
            },
          }
        : {},
    },
  });

  createRoot(document.getElementById("root")!).render(<Fixture />);
}

void initAndMount();
