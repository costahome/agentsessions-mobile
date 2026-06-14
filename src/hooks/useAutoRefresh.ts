import { useCallback, useRef } from 'react';
import { useFocusEffect } from '@react-navigation/native';

/**
 * Live-monitoring helper. Calls `fn` immediately when the screen gains focus,
 * then again every `intervalMs` while it stays focused, and stops on blur.
 * Overlapping invocations are skipped so a slow request can't pile up. This
 * keeps "Running now" / activity views fresh without a manual pull-to-refresh.
 */
export function useAutoRefresh(fn: () => unknown | Promise<unknown>, intervalMs = 10000) {
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const inFlight = useRef(false);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      const tick = async () => {
        if (!active || inFlight.current) return;
        inFlight.current = true;
        try {
          await fnRef.current();
        } catch {
          // swallow — monitoring polls should never crash the screen
        } finally {
          inFlight.current = false;
        }
      };
      tick();
      const id = setInterval(tick, intervalMs);
      return () => {
        active = false;
        clearInterval(id);
      };
    }, [intervalMs])
  );
}
