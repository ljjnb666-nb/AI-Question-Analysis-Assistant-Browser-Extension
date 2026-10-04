/**
 * UI05R-E1 — Connection domain types.
 *
 * `AIConnectionState` is the writable SSOT for AI provider configuration.
 * It lives in ONE `chrome.storage.local` key (`aiConnectionState`) and is the
 * only place connection + credential data may be written through the
 * credential-store/storage helpers.
 *
 * E1 staging note: legacy AI fields in `AppSettings` (providerId, apiKey,
 * apiModel, customBaseUrl, customProviderProtocol) remain the runtime
 * authority until the E2 parseRouter cutover. In E1 this state is created and
 * migrated as a shadow; the legacy fields must not be dual-written anywhere.
 */

/**
 * Runtime provider identifiers. These are persisted values mapped 1:1 from the
 * legacy `AppSettings.providerId` IDs and MUST NOT be renamed. Display labels
 * belong to the frontend provider registry (deferred, not part of E1).
 */
export type ProviderPresetId =
  | "anthropic"
  | "openai"
  | "deepseek"
  | "gemini"
  | "qwen"
  | "moonshot"
  | "zhipu"
  | "minimax"
  | "ollama"
  | "custom";

/**
 * Wire protocol identifiers. E1 defines the boundary only; no new protocol
 * adapters are implemented here.
 */
export type ProtocolId =
  | "anthropic_messages"
  | "openai_chat_completions"
  | "gemini_generate_content";

/**
 * How a runtime request presents credential material. Auth scheme is
 * deliberately separate from the protocol and never carries secret material —
 * it only names the transport location of the credential.
 */
export type AuthScheme =
  | { kind: "bearer" }
  | { kind: "header"; headerName: string }
  | { kind: "query"; parameterName: string }
  | { kind: "none" };

/** Credential material kinds stored in the encrypted credential record. */
export type CredentialType = "api_key";

/**
 * Encrypted credential material and its metadata. `encryptedValue` is always
 * a `qse:v1:` envelope produced by the shared encryption utility; plaintext is
 * never stored in this record. This is application-layer encryption in local
 * extension storage, not an OS keychain.
 */
export interface EncryptedCredentialRecord {
  /** Reference key, equal to its key inside `AIConnectionState.credentials`. */
  ref: string;
  type: CredentialType;
  /** `qse:v1:<base64>` envelope. Never plaintext. */
  encryptedValue: string;
  /** Incremented on every replacement; validation binds to this revision. */
  revision: number;
  updatedAt: number;
}

export type ValidationStatus =
  | "never_tested"
  | "testing"
  | "validated"
  | "failed"
  | "stale";

/**
 * Validation binds to configuration revisions, never to credential plaintext.
 * A validation result may only be honored when the connection and credential
 * revisions it recorded still match the current ones.
 */
export interface ValidationRecord {
  status: ValidationStatus;
  /** Monotonic generation counter for in-flight validation attempts. */
  generation: number;
  validatedConnectionRevision?: number;
  validatedCredentialRevision?: number;
  validatedAt?: number;
  errorCode?: string;
}

/**
 * Model capability profile. E1 creates the type boundary only — no capability
 * enforcement or parseRouter change belongs to E1.
 */
export interface ModelCapabilities {
  text: boolean;
  vision: boolean;
  reasoning?: boolean;
  structuredOutput?: boolean;
}

/**
 * Media transport capabilities of a connection/protocol combination. Type
 * boundary only in E1.
 */
export interface TransportMediaCapabilities {
  inlineBase64: boolean;
  remoteImageUrl: boolean;
  multipleImages: boolean;
}

/**
 * A user-configured AI service instance. Official provider presets inherit
 * their protocol and endpoint; a custom connection may override either.
 */
export interface Connection {
  id: string;
  name: string;
  presetId: ProviderPresetId;
  /** Overrides the preset default endpoint (custom connections). */
  endpointOverride?: string;
  /** Overrides the preset default protocol (custom connections). */
  protocolOverride?: ProtocolId;
  authScheme: AuthScheme;
  /** Reference into `AIConnectionState.credentials`; never secret material. */
  credentialRef?: string;
  selectedModelId: string;
  /** Incremented on every runtime-relevant modification of this connection. */
  connectionRevision: number;
  validation: ValidationRecord;
  createdAt: number;
  updatedAt: number;
}

/**
 * The single writable SSOT for AI provider configuration, stored under ONE
 * `chrome.storage.local` key (`aiConnectionState`). Do not create
 * independently writable connection or credential stores beside it.
 */
export interface AIConnectionState {
  schemaVersion: 1;
  /** Whole-state revision; incremented on every successful mutation. */
  revision: number;
  activeConnectionId: string | null;
  connections: Record<string, Connection>;
  credentials: Record<string, EncryptedCredentialRecord>;
}

/**
 * Non-secret projection of a connection for metadata readers. Guaranteed to
 * contain no credential material — only presence and revision of the
 * referenced credential.
 */
export interface ConnectionMetadata {
  id: string;
  name: string;
  presetId: ProviderPresetId;
  /** Resolved protocol: protocolOverride when set, otherwise the preset default. */
  protocol: ProtocolId;
  /** Resolved endpoint: endpointOverride when set, otherwise the preset default. */
  endpoint: string;
  authScheme: AuthScheme;
  credentialRef?: string;
  hasCredential: boolean;
  credentialRevision?: number;
  selectedModelId: string;
  connectionRevision: number;
  validation: ValidationRecord;
  createdAt: number;
  updatedAt: number;
}
