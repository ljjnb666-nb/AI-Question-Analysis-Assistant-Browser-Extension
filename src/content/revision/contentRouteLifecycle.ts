import { routeFingerprintForLocation } from "./questionRevisionRegistry";
import { abortQuestionRevisionAttempt, revisionRegistry } from "./questionRevisionRuntime";

/** Poll cadence bounds URL-only pushState/replaceState detection without patching page-world history methods. */
export const CONTENT_ROUTE_POLL_INTERVAL_MS = 50;

/** One runtime-owned route observer for browser navigation events and URL-only SPA transitions. */
export function startContentRouteLifecycleWatch(onRouteChange: () => void): () => void {
  let disposed = false;
  let observedFingerprint = routeFingerprintForLocation();

  const observeLocation = () => {
    if (disposed) return;
    const nextFingerprint = routeFingerprintForLocation();
    if (nextFingerprint === observedFingerprint) return;

    observedFingerprint = nextFingerprint;
    revisionRegistry().refreshRoute();
    try {
      onRouteChange();
    } finally {
      abortQuestionRevisionAttempt();
    }
  };

  window.addEventListener("popstate", observeLocation);
  window.addEventListener("hashchange", observeLocation);
  const poll = window.setInterval(observeLocation, CONTENT_ROUTE_POLL_INTERVAL_MS);

  return () => {
    if (disposed) return;
    disposed = true;
    window.clearInterval(poll);
    window.removeEventListener("popstate", observeLocation);
    window.removeEventListener("hashchange", observeLocation);
  };
}
