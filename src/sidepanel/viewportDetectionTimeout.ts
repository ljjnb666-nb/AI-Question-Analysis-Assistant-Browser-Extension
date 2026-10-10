/** A UI timeout bounds waiting, not the content-owned run. */
export const VIEWPORT_COMMAND_TIMEOUT_MS = 12_000;
export type ViewportCommandOutcome<T> =
  | { timedOut: false; value: T }
  | { timedOut: true };

export async function awaitViewportCommand<T>(
  operation: Promise<T>,
  timeoutMs = VIEWPORT_COMMAND_TIMEOUT_MS,
  onTimeout?: () => void,
): Promise<ViewportCommandOutcome<T>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation.then((value): ViewportCommandOutcome<T> => ({ timedOut: false, value })),
      new Promise<ViewportCommandOutcome<T>>((resolve) => {
        timer = setTimeout(() => {
          onTimeout?.();
          resolve({ timedOut: true });
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
