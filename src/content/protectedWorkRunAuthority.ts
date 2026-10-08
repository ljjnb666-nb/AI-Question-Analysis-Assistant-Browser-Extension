import type { ProtectedWorkKind } from "@/shared/auth/protectedWorkOwner";

/**
 * Content Runtime's synchronous execution authority. START and STOP/CANCEL
 * messages are handled on one JS event loop; no await occurs between
 * comparing an active generation and dispatching the actual stop callback.
 *
 * Legacy no-token runs can only be stopped by legacy no-token messages.
 * New token-aware runs can only be stopped by an exact matching token.
 * A duplicated START while an older generation is running is refused, not
 * interpreted as CANCEL (the old Full Page click-to-cancel behavior).
 */
export function createProtectedWorkRunAuthority() {
  const active = new Map<ProtectedWorkKind, { generationId?: string }>();

  return {
    begin(kind: ProtectedWorkKind, generationId?: string): boolean {
      if (active.has(kind)) return false;
      active.set(kind, { generationId });
      return true;
    },
    canStop(kind: ProtectedWorkKind, generationId?: string): boolean {
      const current = active.get(kind);
      return current !== undefined && current.generationId === generationId;
    },
    finish(kind: ProtectedWorkKind, generationId?: string): void {
      if (active.get(kind)?.generationId === generationId) active.delete(kind);
    },
    reset(): void {
      active.clear();
    },
  };
}
