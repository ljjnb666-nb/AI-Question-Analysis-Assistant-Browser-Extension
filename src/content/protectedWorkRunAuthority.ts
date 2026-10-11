import type { ProtectedWorkKind } from "@/shared/auth/protectedWorkOwner";

/**
 * Content Runtime's synchronous execution authority. START and STOP/CANCEL
 * messages are handled on one JS event loop; no await occurs between
 * comparing an active generation and dispatching the actual stop callback.
 *
 * Legacy no-token runs can only be stopped by legacy no-token messages.
 * New token-aware runs can only be stopped by an exact matching token.
 * A duplicated START while its generation is live is refused, not
 * interpreted as CANCEL (the old Full Page click-to-cancel behavior).
 * After exact STOP has revoked the old lease, a DIFFERENT tagged generation
 * may begin before the old async task reaches finally. Old finally/STOP
 * can never delete or cancel the replacement lease.
 */
export function createProtectedWorkRunAuthority() {
  let nextLease = 0;
  const active = new Map<ProtectedWorkKind, { generationId?: string; lease: number; revoked: boolean }>();

  return {
    begin(kind: ProtectedWorkKind, generationId?: string): number | null {
      const previous = active.get(kind);
      // A cancelled tagged run is no longer execution authority, even when its
      // promise has not reached finally. The successor must have a NEW tagged
      // identity: never re-enter the cancelled generation or let a legacy
      // untagged request bypass its cleanup barrier.
      if (previous && (!previous.revoked || !generationId
        || previous.generationId === generationId)) return null;
      // Unique local execution lease even for repeated legacy (untagged)
      // runs after a SPA reset. Old finally handlers cannot clear new runs.
      const lease = ++nextLease;
      active.set(kind, { generationId, lease, revoked: false });
      return lease;
    },
    canStop(kind: ProtectedWorkKind, generationId?: string): boolean {
      const current = active.get(kind);
      return current !== undefined && current.generationId === generationId;
    },
    isOwner(kind: ProtectedWorkKind, lease: number): boolean {
      return active.get(kind)?.lease === lease;
    },
    isCurrent(kind: ProtectedWorkKind, lease: number): boolean {
      const current = active.get(kind);
      return current !== undefined && current.lease === lease && !current.revoked;
    },
    revoke(kind: ProtectedWorkKind, generationId?: string): boolean {
      const current = active.get(kind);
      if (!current || current.generationId !== generationId || current.revoked) return false;
      current.revoked = true;
      return true;
    },
    finish(kind: ProtectedWorkKind, lease: number): void {
      if (active.get(kind)?.lease === lease) active.delete(kind);
    },
    reset(): void {
      active.clear();
    },
  };
}
