import { useEffect, useState } from "react";

function popstateEvent() {
  return new PopStateEvent("popstate");
}

export function navigateTo(path: string) {
  window.history.pushState({}, "", path);
  window.dispatchEvent(popstateEvent());
}

export function useAdminPath(): string {
  const [path, setPath] = useState<string>(() => window.location.pathname);
  useEffect(() => {
    const sync = () => setPath(window.location.pathname);
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);
  return path;
}
