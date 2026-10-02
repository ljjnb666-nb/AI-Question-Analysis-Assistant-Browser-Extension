/**
 * UI-02 Commercial Context Console Presentation State Model
 *
 * NOTE: This is a pure presentation projection layer, NOT an authority source.
 * Authority remains server-authoritative (useAuthController, createPopupAuthority,
 * isProviderRuntimeConfigured).
 */

export type PopupViewState =
  | "checking_session"
  | "signed_out"
  | "service_unavailable"
  | "page_unavailable"
  | "provider_setup_required"
  | "ready"
  | "running"
  | "review_required";

export interface DerivePopupViewStateParams {
  authStatus?: "loading" | "validating" | "authenticated" | "unauthenticated" | "server_unavailable";
  isAuthenticated: boolean;
  isSessionPending?: boolean;
  isServerUnavailable?: boolean;
  isPageInjectable?: boolean | null;
  hasApiKey?: boolean;
  activeFeature?: string | null;
  reviewReason?: string | null;
}

/**
 * Pure projection function that derives the high-level presentation view state.
 */
export function derivePopupViewState(params: DerivePopupViewStateParams): PopupViewState {
  const {
    authStatus,
    isAuthenticated,
    isSessionPending = false,
    isServerUnavailable = false,
    isPageInjectable = true,
    hasApiKey = false,
    activeFeature = null,
    reviewReason = null,
  } = params;

  if (isSessionPending || authStatus === "loading" || authStatus === "validating") {
    return "checking_session";
  }

  if (isServerUnavailable || authStatus === "server_unavailable") {
    return "service_unavailable";
  }

  if (!isAuthenticated || authStatus === "unauthenticated") {
    return "signed_out";
  }

  // From here, user is authenticated:
  if (isPageInjectable === false) {
    return "page_unavailable";
  }

  if (reviewReason) {
    return "review_required";
  }

  if (activeFeature != null && activeFeature !== "") {
    return "running";
  }

  if (!hasApiKey) {
    return "provider_setup_required";
  }

  return "ready";
}
