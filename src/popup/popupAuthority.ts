import type { AuthSessionCoordinator } from "@/shared/auth/authSessionCoordinator";

export type PopupAuthority = {
  /**
   * Synchronous authority check against the live session coordinator.
   * Popup protected handlers must consult this — never a React render
   * snapshot or an effect-lagged ref, which would leave a stale-authority
   * window between a coordinator transition and the next passive effect.
   */
  isAuthenticatedNow: () => boolean;
};

export function createPopupAuthority(session: AuthSessionCoordinator): PopupAuthority {
  return {
    isAuthenticatedNow: () => session.getState().status === "authenticated",
  };
}
