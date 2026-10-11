import type { ConnectionMetadata } from "@/shared/types/connection";
import type { UILang } from "./displayUtils";
import type { ParseResult } from "@/shared/types/parse";
import { parseQuestion } from "@/shared/utils/parseRouter";
import {
  AIConnectionCommandError,
  beginAIConnectionValidation,
  finishAIConnectionValidation,
} from "@/shared/utils/aiConnectionClient";

/** Only committed provider-owned runtime evidence can authorize persisted Ready. */
export async function runCommittedAIConnectionProbe(
  expected: ConnectionMetadata,
  language: UILang,
): Promise<{ result: ParseResult; metadata: ConnectionMetadata }> {
  const ticket = await beginAIConnectionValidation();
  let committed = false;
  try {
    if (ticket.connectionId !== expected.id ||
        ticket.connectionRevision !== expected.connectionRevision ||
        ticket.credentialRevision !== (expected.credentialRevision ?? 0)) {
      throw new AIConnectionCommandError("AI_CONNECTION_VALIDATION_STALE");
    }

    const result = await parseQuestion({
      id: "test",
      bbox: { x: 0, y: 0, width: 100, height: 50 },
      previewText: "1+1=? A.1 B.2 C.3 D.4",
      hasImage: false,
      questionTypeGuess: "single_choice",
      confidence: 1,
      source: "manual_capture",
    }, { preferredRoute: "text", language });

    if (result?.resultSource !== "provider" ||
        typeof result.answer !== "string" || !result.answer.trim()) {
      throw new AIConnectionCommandError("AI_CONNECTION_TEST_NOT_PROVIDER");
    }
    // The background rechecks ID, config revision, credential revision and generation
    // in the single-writer lock. Never turn a local parse response into local Ready.
    const response = await finishAIConnectionValidation(ticket, "success");
    committed = true;
    const metadata = response.metadata;
    if (!metadata || metadata.id !== ticket.connectionId ||
        metadata.connectionRevision !== ticket.connectionRevision ||
        (metadata.credentialRevision ?? 0) !== ticket.credentialRevision ||
        metadata.validation?.status !== "validated" ||
        metadata.validation.generation !== ticket.generation ||
        metadata.validation.validatedConnectionRevision !== ticket.connectionRevision ||
        (metadata.validation.validatedCredentialRevision ?? 0) !== ticket.credentialRevision) {
      throw new AIConnectionCommandError("AI_CONNECTION_VALIDATION_STALE");
    }
    return { result, metadata };
  } catch (error) {
    if (!committed) {
      // Best effort failure: a competing test/config edit may have revoked this lease.
      // It must not overwrite the successor's persisted validation authority.
      await finishAIConnectionValidation(ticket, "failed").catch(() => undefined);
    }
    throw error;
  }
}
