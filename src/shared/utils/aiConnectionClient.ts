import type {
  AIConnectionCommand,
  AIConnectionResponse,
} from "../types/aiConnectionMessages";
export class AIConnectionCommandError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "AIConnectionCommandError";
  }
}
export async function sendAIConnectionCommand(command: AIConnectionCommand) {
  const response = (await chrome.runtime.sendMessage(command)) as
    | AIConnectionResponse
    | undefined;
  if (!response || response.ok !== true)
    throw new AIConnectionCommandError(response?.code ?? "AI_CONNECTION_BACKGROUND_UNAVAILABLE");
  return response;
}
export function ensureAIConnectionAuthorityReady() {
  return sendAIConnectionCommand({ type: "AI_CONNECTION_ENSURE_INITIALIZED" });
}
