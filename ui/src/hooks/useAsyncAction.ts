import { useCallback, useRef, useState } from "react";
import { friendlyError, type FriendlyError } from "../errors";

// useAsyncAction gives one area of the UI its own busy flag and its own error,
// so a failure in one place never wipes or hides an error somewhere else.
// run() resolves to the task's result, or undefined when it failed.
export function useAsyncAction(action = "That") {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<FriendlyError | null>(null);
  const inFlight = useRef(0);

  const run = useCallback(
    async <T,>(task: () => Promise<T>, failureAction = action): Promise<T | undefined> => {
      inFlight.current += 1;
      setBusy(true);
      setError(null);
      try {
        return await task();
      } catch (err) {
        setError(friendlyError(err, failureAction));
        return undefined;
      } finally {
        inFlight.current -= 1;
        if (inFlight.current === 0) setBusy(false);
      }
    },
    [action],
  );

  const clear = useCallback(() => setError(null), []);
  const fail = useCallback((err: unknown, failureAction = action) => setError(friendlyError(err, failureAction)), [action]);

  return { busy, error, run, clear, fail };
}
