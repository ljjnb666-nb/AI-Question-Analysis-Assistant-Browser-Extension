import type { createProtectedWorkRunAuthority } from "./protectedWorkRunAuthority";

type AutoSolveAuthority = Pick<ReturnType<typeof createProtectedWorkRunAuthority>, "revoke">;

type StopEffects = {
  requestStop: () => void;
  releaseRunning: () => void;
  abortCurrentAttempt: () => void;
};

/**
 * STOP revokes its exact generation before changing shared runtime state.
 * Pending Provider IO cannot keep the next authorized START behind an old
 * isRunning() gate; late old work remains fenced by the revoked lease.
 */
export function stopAutoSolveAndReleaseRunning(
  authority: AutoSolveAuthority,
  generationId: string | undefined,
  effects: StopEffects,
): boolean {
  if (!authority.revoke("autoSolve", generationId)) return false;
  effects.requestStop();
  effects.releaseRunning();
  effects.abortCurrentAttempt();
  return true;
}
