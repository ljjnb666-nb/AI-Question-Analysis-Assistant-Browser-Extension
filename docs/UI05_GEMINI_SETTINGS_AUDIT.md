# UI05_GEMINI_SETTINGS_AUDIT

> **Historical Notice**: This document records the pre-redesign baseline of the settings panel prior to UI-05 and E2B-2B authority closure. Active architecture is governed by `docs/UI05R_PROVIDER_CONNECTION_ARCHITECTURE.md` and background single-writer authorities.

## 1. CURRENT_SETTINGS_STRUCTURE
The current Settings page (`src/sidepanel/settingsPanel.tsx` and `src/sidepanel/settingsSections.tsx`) is structured as a vertical stack of `SectionCard` containers:
- **Auth Gate (`authOnly` mode)**: If the user is unauthenticated, `SettingsTab` renders only `SettingsAccountSection` (registration and login views).
- **Settings Configuration (`SettingsConfigSections`)**:
  - **Provider**: A 2-column grid of 10 equal-weight buttons with custom gradients, rendering provider name, vision support label, and key-optional hint.
  - **API Key**: Password field with placeholder and external developer console link. Displays a static missing-key hint when empty.
  - **Model**: Dropdown select (`<select>`) for standard providers, or text `<input>` for the `custom` provider.
  - **Custom Protocol**: Radio group for OpenAI Compatible vs Claude Compatible (rendered only when `providerId === 'custom'`).
  - **Base URL**: Rendered conditionally for `ollama`, `openai`, `custom`, `anthropic`, `minimax`.
  - **Analytics Backend**: Input for `analyticsBaseUrl` and static `deviceId` hint.
  - **Usage Analytics**: Checkbox toggle for optional minimized telemetry.
  - **Parse Route**: Radio group for Auto / Text First / Vision First.
  - **Language**: 2 buttons for Chinese (中文) and English.
- **Account Section (`SettingsAccountSection`)**: Current user email, User ID, and Logout button (or login/register form).
- **Actions Section (`SettingsActionsSection`)**: "Save Settings" button and "Connection Test" button in a card, followed by an optional test result banner.

## 2. PROVIDER_SOURCE_OF_TRUTH
Defined in `src/shared/ai/providers.ts`:
- Registry: `PROVIDERS: ProviderConfig[]` containing exactly 10 supported providers:
  1. `anthropic` ("Anthropic (Claude)")
  2. `openai` ("OpenAI (GPT)")
  3. `deepseek` ("DeepSeek")
  4. `gemini` ("Google Gemini")
  5. `qwen` ("阿里云通义千问")
  6. `moonshot` ("Moonshot Kimi")
  7. `zhipu` ("智谱 GLM")
  8. `minimax` ("MiniMax")
  9. `ollama` ("Ollama（本地）")
  10. `custom` ("Custom（OpenAI 兼容）")
- Helper functions:
  - `getProvider(id: string): ProviderConfig`
  - `getProviderShortName(id: string): string`
  - `resolveEffectiveProviderMediaCapabilities(provider, customProviderProtocol)`

## 3. MODEL_SOURCE_OF_TRUTH
Defined in each provider's `ProviderConfig` in `src/shared/ai/providers.ts`:
- `defaultModel`: Canonical fallback model string per provider (e.g. `claude-opus-4.8`, `gpt-5.5`, `deepseek-v4-flash`, `gemini-2.5-flash`, `qwen3-vl-plus`, `kimi-k2.6`, `glm-5v-turbo`, `MiniMax-M3`, `qwen3-vl`, `gpt-5.4-mini`).
- `models`: Array of known selectable models per provider.
- For `custom`: User enters arbitrary model string in an input.
- For standard providers: Selection is driven from `provider.models`, with option to specify custom model if needed.

## 4. API_KEY_STORAGE
Defined in `src/shared/utils/storage.ts`:
- Storage Area: `chrome.storage.local` under key `appSettings`.
- Sensitive Keys: `["apiKey", "authToken"]`.
- Encryption: When saved, `saveSettings()` encrypts `apiKey` with AES-GCM via `encryptValue()` (`src/shared/utils/encryption.ts`) into a `qse:v1:...` envelope.
- Decryption: When loaded via `loadSettings()`, `decryptValue()` decrypts the envelope. Tampered credentials fail closed to `""`.
- In-memory cache in `storage.ts` preserves plaintext for active session operations without re-encrypting on every read.

## 5. BASE_URL_RULES
- Base URL defaults to `provider.baseUrl` from `src/shared/ai/providers.ts`.
- `customBaseUrl` in `AppSettings` is optional (`src/shared/types/settings.ts`).
- When provided, `buildApiUrl(baseUrl, endpoint)` in `src/shared/ai/providerClients.ts` normalizes `/v1` and `/v1beta` prefixes and trailing slashes.
- Cloud providers (DeepSeek, Gemini, Qwen, Moonshot, Zhipu) have official fixed endpoints and rarely need Base URL overrides in normal use.
- Local provider `ollama` defaults to `http://localhost:11434`.
- `custom` provider requires endpoint specification.

## 6. PROVIDER_CAPABILITIES
Governed by `ProviderConfig`:
- `supportsVision`: `true` for all except `deepseek` (`false`).
- `keyOptional`: `true` for `ollama`, `false` / omitted for all others.
- `authHeader`: `"x-api-key"` (Anthropic), `"bearer"` (OpenAI, DeepSeek, Qwen, Moonshot, Zhipu, MiniMax, Custom), `"none"` (Gemini query param auth, Ollama local no auth).
- Media capabilities: `supportsRemoteImageUrl`, `supportsInlineBase64`, `supportsMultipleImages`.

## 7. SAVE_SEMANTICS
- Settings uses explicit save via `saveSettings(partial)`.
- Modifying UI form inputs updates local component state only; changes are NOT committed to `chrome.storage.local` until the user clicks "Save Settings".
- Previously, the UI lacked a "dirty state" (edited vs saved) indicator, meaning users could not tell if their current on-screen edits were committed or pending save.

## 8. VALIDATION_CAPABILITY
- Safe validation already exists in `settingsPanel.tsx`:
  - `handleTest()` calls `parseQuestion(testBlock, settings)` using a synthetic question block (`1+1=? A.1 B.2 C.3 D.4`).
  - Pre-flight gate: `isProviderRuntimeConfigured(provider, { apiKey })` checks whether the provider has required credentials before dispatching. If unconfigured, returns `PROVIDER_NOT_CONFIGURED` without sending any network request.
  - Error classification: `mapUserFacingError(error, lang, { context: "connection-test" })` maps network timeouts (`CONNECTION_NETWORK`), 401/403 credentials rejected (`CONNECTION_UNAUTHORIZED`), 404 endpoint/model not found (`CONNECTION_NOT_FOUND`), and generic failures into safe, localized user feedback.
  - Technical details are clamped to 200 characters and demoted to secondary fields, never displayed as raw stack traces or exposed API keys.
- **Contract Status**: EXISTING. No new backend contract is required.

## 9. AUTH_PROVIDER_SEPARATION
- Account Authentication (`useAuthController`, `useAuthSession`, `userId`, `userEmail`, `authToken`) governs the user's account session with the extension backend.
- AI Provider Configuration (`providerId`, `apiKey`, `apiModel`, `customBaseUrl`) governs direct browser-to-LLM inference.
- **Strict Boundary**:
  - Configuring a valid API key NEVER logs a user in or changes account state.
  - Logging in with an email/password NEVER configures or validates an AI provider.
  - When unauthenticated, the user must first sign in before AI provider configuration is unlocked in the side panel.

## 10. FIRST_RUN_GAPS
- When a user logs in for the first time, Settings presented a full engineering form with 10 provider cards, empty inputs, and advanced technical settings.
- No onboarding guidance or setup progress model (e.g. ① Choose Provider → ② Enter API Key → ③ Select Model → ④ Test Connection).
- No clear status explaining whether the provider is Not Configured, Saved but Untested, Testing, or Ready.
- Unclear what actions are required vs optional to start solving questions.

## 11. SECURITY_RISKS
- The API Key field was a standard password field with no Show/Hide toggle, preventing users from checking for typos or clipboard errors.
- Any new Show/Hide toggle must mask by default.
- Real API keys must NEVER be logged, displayed in error messages, or included in test fixtures.
- Test fixtures must strictly use synthetic strings like `sk-test-ui05-example`.

## 12. UX_PROBLEMS
- Overwhelming density: 10 large buttons, multiple cards, advanced options (analytics URL, custom protocols, routes) all visible at once.
- Poor mobile/sidepanel responsiveness at 320px–360px widths (grid overflows, button wrapping).
- No progressive disclosure for advanced settings (Base URL, Route, Analytics, Custom Protocol).
- Success state does not collapse into a clean, calm "AI Configuration Ready" banner.

## 13. BACKEND_CONTRACT_GAPS
- **None**: All required runtime functions (`loadSettings`, `saveSettings`, `getProvider`, `isProviderRuntimeConfigured`, `parseQuestion`, `mapUserFacingError`, `useAuthController`) exist and are safe.
- Frontend has complete authority to redesign presentation, progressive disclosure, first-run step flow, and semantic status indicators without altering runtime/security contracts.
