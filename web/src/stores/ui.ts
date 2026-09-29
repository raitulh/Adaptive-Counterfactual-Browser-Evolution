"use client";

/**
 * Lightweight client UI state (Zustand). Server data never lives here — that is TanStack Query's job.
 * Only harmless preferences are persisted (never tokens or user data).
 */
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

interface UiState {
  sidebarCollapsed: boolean;
  /** Advanced/developer details: ids, sequences, tool versions, raw event data. */
  developerMode: boolean;
  commandOpen: boolean;
  notificationsOpen: boolean;
  mobileNavOpen: boolean;
  /** Incremented to ask the task composer to focus (e.g. from the command palette). */
  composerFocusTick: number;
  toggleSidebar: () => void;
  setDeveloperMode: (on: boolean) => void;
  setCommandOpen: (open: boolean) => void;
  setNotificationsOpen: (open: boolean) => void;
  setMobileNavOpen: (open: boolean) => void;
  focusComposer: () => void;
}

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      sidebarCollapsed: false,
      developerMode: false,
      commandOpen: false,
      notificationsOpen: false,
      mobileNavOpen: false,
      composerFocusTick: 0,
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      setDeveloperMode: (developerMode) => set({ developerMode }),
      setCommandOpen: (commandOpen) => set({ commandOpen }),
      setNotificationsOpen: (notificationsOpen) => set({ notificationsOpen }),
      setMobileNavOpen: (mobileNavOpen) => set({ mobileNavOpen }),
      focusComposer: () => set((s) => ({ composerFocusTick: s.composerFocusTick + 1 })),
    }),
    {
      name: "agentos-ui",
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ sidebarCollapsed: s.sidebarCollapsed, developerMode: s.developerMode }),
      // Rehydrated after mount (see Providers) so server and first client render match.
      skipHydration: true,
    },
  ),
);
