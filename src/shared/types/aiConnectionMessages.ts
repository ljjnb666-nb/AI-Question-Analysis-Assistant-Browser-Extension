import type { ConnectionMetadata, ProviderPresetId } from "./connection";

export type CredentialAction =
  | { action: "KEEP" }
  | { action: "CLEAR" }
  | { action: "REPLACE"; value: string };
export interface LegacyAISettingsPatch {
  providerId?: ProviderPresetId;
  apiModel?: string;
  customBaseUrl?: string;
  customProviderProtocol?: "openai" | "anthropic";
  credential: CredentialAction;
}
export type AIConnectionCommand =
  | { type: "AI_CONNECTION_ENSURE_INITIALIZED" }
  | { type: "AI_CONNECTION_GET_ACTIVE_METADATA" }
  | {
      type: "AI_CONNECTION_APPLY_LEGACY_SETTINGS";
      settings: LegacyAISettingsPatch;
    };
export type AIConnectionResponse =
  | {
      ok: true;
      initialized: true;
      migrated: boolean;
      revision: number;
      metadata: ConnectionMetadata | null;
    }
  | { ok: false; code: string };
