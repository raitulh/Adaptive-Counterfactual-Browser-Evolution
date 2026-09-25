"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

/**
 * Small cross-component UI state for the dashboard shell: the sidebar and the
 * top bar both read and toggle it. Persisted, and rehydrated after mount
 * (`skipHydration`) so the server render never mismatches.
 */
interface DashboardUiState {
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
}

export const useDashboardUi = create<DashboardUiState>()(
  persist(
    (set) => ({
      sidebarCollapsed: false,
      toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
      setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
    }),
    {
      name: "realhuman.dashboard-ui",
      storage: createJSONStorage(() => localStorage),
      skipHydration: true,
      partialize: (state) => ({ sidebarCollapsed: state.sidebarCollapsed }),
    },
  ),
);
