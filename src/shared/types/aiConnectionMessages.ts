import type { ConnectionMetadata, ProviderPresetId, ProtocolId } from "./connection";

export type CredentialAction =
  | { action: "KEEP" }
  | { action: "CLEAR" }
  | { action: "REPLACE"; value: string };
export interface AIConnectionUpdatePatch {
  presetId?: ProviderPresetId;
  selectedModelId?: string;
  endpointOverride?: string | null;
  protocolOverride?: Extract<ProtocolId, "openai_chat_completions" | "anthropic_messages"> | null;
  credential: CredentialAction;
}
export type AIConnectionCommand =
  | { type: "AI_CONNECTION_ENSURE_INITIALIZED" }
  | { type: "AI_CONNECTION_GET_ACTIVE_METADATA" }
  | { type: "AI_CONNECTION_GET_EDITOR_VIEW" }
  | {
      type: "AI_CONNECTION_UPDATE_ACTIVE";
      patch: AIConnectionUpdatePatch;
    };
export type AIConnectionResponse =
  | {
      ok: true;
      initialized: true;
      migrated: boolean;
      revision: number;
      metadata: ConnectionMetadata | null;
      editorView?: AIConnectionEditorView;
    }
  | { ok: false; code: string };

/** Active connection editing projection. No credential identifiers or material. */
export interface AIConnectionEditorView {
  presetId: ProviderPresetId;
  selectedModelId: string;
  endpointOverride: string | null;
  protocol: ProtocolId;
  hasCredential: boolean;
}
