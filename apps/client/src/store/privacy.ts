import { create } from "zustand";
import type { LastSeenVisibility } from "@pm/shared";
import { api } from "../api";

interface PrivacyState {
  /** Who sees the user's last seen time; null until loaded. */
  lastSeen: LastSeenVisibility | null;
  fetch: () => Promise<void>;
  /** Errors are rethrown for the form to show. */
  setLastSeen: (value: LastSeenVisibility) => Promise<void>;
  reset: () => void;
}

/** The signed-in user's privacy settings. */
export const usePrivacy = create<PrivacyState>((set) => ({
  lastSeen: null,
  fetch: async () => {
    const { lastSeen } = await api.getPrivacy();
    set({ lastSeen });
  },
  setLastSeen: async (value) => {
    const { lastSeen } = await api.updatePrivacy({ lastSeen: value });
    set({ lastSeen });
  },
  reset: () => set({ lastSeen: null }),
}));
