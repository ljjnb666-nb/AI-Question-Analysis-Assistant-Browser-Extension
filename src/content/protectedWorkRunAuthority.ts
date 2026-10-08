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
  let nextLease = 0;
  const active = new Map<ProtectedWorkKind, { generationId?: string; lease: number }>();

  return {
    begin(kind: ProtectedWorkKind, generationId?: string): number | null {
      if (active.has(kind)) return null;
      // Unique local execution lease even for repeated legacy (untagged)
      // runs after a SPA reset. Old finally handlers cannot clear new runs.
      const lease = ++nextLease;
      active.set(kind, { generationId, lease });
      return lease;
    },
    canStop(kind: ProtectedWorkKind, generationId?: string): boolean {
      const current = active.get(kind);
      return current !== undefined && current.generationId === generationId;
    },
    finish(kind: ProtectedWorkKind, lease: number): void {
      if (active.get(kind)?.lease === lease) active.delete(kind);
    },
    reset(): void {
      active.clear();
    },
  };
}
