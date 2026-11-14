"use client";

import { useSyncExternalStore } from "react";
import {
  getLocalCalendarDateKey,
  getMsUntilNextLocalMidnight,
} from "@/lib/datePresets";

const emptySubscribe = () => () => {};

/**
 * Tracks the viewer's current local calendar day ("YYYY-MM-DD") without SSR
 * hydration mismatches (returns "" during server rendering) and automatically
 * refreshes when crossing local midnight or resuming a long-lived background tab.
 */
export function useLocalCalendarDay(enabled = true): string {
  return useSyncExternalStore(
    (onStoreChange) => {
      if (!enabled || typeof window === "undefined") {
        return emptySubscribe();
      }

      let timeoutId: ReturnType<typeof setTimeout> | undefined;

      const scheduleMidnightRefresh = () => {
        if (timeoutId !== undefined) {
          clearTimeout(timeoutId);
        }
        const delayMs = getMsUntilNextLocalMidnight(new Date());
        timeoutId = setTimeout(() => {
          onStoreChange();
          scheduleMidnightRefresh();
        }, delayMs);
      };

      const handleWakeOrFocus = () => {
        if (
          typeof document !== "undefined" &&
          document.visibilityState === "hidden"
        ) {
          return;
        }
        onStoreChange();
        scheduleMidnightRefresh();
      };

      scheduleMidnightRefresh();
      window.addEventListener("focus", handleWakeOrFocus);
      if (typeof document !== "undefined") {
        document.addEventListener("visibilitychange", handleWakeOrFocus);
      }

      return () => {
        if (timeoutId !== undefined) {
          clearTimeout(timeoutId);
        }
        window.removeEventListener("focus", handleWakeOrFocus);
        if (typeof document !== "undefined") {
          document.removeEventListener("visibilitychange", handleWakeOrFocus);
        }
      };
    },
    () => (enabled ? getLocalCalendarDateKey(new Date()) : ""),
    () => ""
  );
}
