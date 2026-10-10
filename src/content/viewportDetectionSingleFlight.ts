/**
 * Content-owned single flight shared by Side Panel, Popup and Alt+W.
 * A UI timeout must never release this gate while content is running.
 */
export function createViewportDetectionSingleFlight(
  start: (requestId?: string) => void | Promise<void>,
  isRuntimeCurrent: () => boolean,
): (requestId?: string) => Promise<void> | false {
  let running = false;
  return (requestId?: string) => {
    if (running || !isRuntimeCurrent()) return false;
    running = true;
    try {
      const task = Promise.resolve(start(requestId)).finally(() => { running = false; });
      // Keyboard and legacy callers do not await; tagged callers still receive
      // the original rejection for their terminal-error response.
      void task.catch(() => undefined);
      return task;
    } catch (error) {
      running = false;
      const rejected: Promise<void> = Promise.reject(error);
      void rejected.catch(() => undefined);
      return rejected;
    }
  };
}
