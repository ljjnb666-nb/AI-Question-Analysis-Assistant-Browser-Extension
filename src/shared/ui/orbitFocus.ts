import { useEffect, useState, useCallback } from "react";

let isKeyboardModality = false;
let isInitialized = false;

/**
 * Initializes global pointer/keyboard modality event listeners once.
 */
export function initFocusVisibleTracker(): void {
  if (typeof window === "undefined" || isInitialized) return;
  isInitialized = true;

  window.addEventListener(
    "keydown",
    (e) => {
      // Ignore meta keys (Cmd, Ctrl, Alt)
      if (e.metaKey || e.altKey || e.ctrlKey) return;
      isKeyboardModality = true;
    },
    { capture: true }
  );

  window.addEventListener(
    "mousedown",
    () => {
      isKeyboardModality = false;
    },
    { capture: true }
  );

  window.addEventListener(
    "pointerdown",
    () => {
      isKeyboardModality = false;
    },
    { capture: true }
  );

  window.addEventListener(
    "touchstart",
    () => {
      isKeyboardModality = false;
    },
    { capture: true }
  );
}

/**
 * Explicit helper for deterministic testing of keyboard vs mouse focus modality.
 */
export function setKeyboardModalityForTesting(isKeyboard: boolean): void {
  isKeyboardModality = isKeyboard;
}

/**
 * Returns current keyboard focus modality.
 */
export function getIsKeyboardModality(): boolean {
  return isKeyboardModality;
}

/**
 * Unified focus-visible hook for interactive Orbit primitives.
 * Applies focus ring only when keyboard modality is active and component is not disabled.
 */
export function useFocusVisible(disabled = false): {
  isFocusVisible: boolean;
  onFocus: (e?: React.FocusEvent) => void;
  onBlur: (e?: React.FocusEvent) => void;
} {
  useEffect(() => {
    initFocusVisibleTracker();
  }, []);

  const [isFocusVisible, setIsFocusVisible] = useState(false);

  const onFocus = useCallback(
    () => {
      if (disabled) {
        setIsFocusVisible(false);
        return;
      }
      setIsFocusVisible(getIsKeyboardModality());
    },
    [disabled]
  );

  const onBlur = useCallback(() => {
    setIsFocusVisible(false);
  }, []);

  return { isFocusVisible, onFocus, onBlur };
}
