import * as SecureStore from "expo-secure-store";
import { create } from "zustand";
import type { User } from "@pm/shared";
import { ApiRequestError, api, setApiToken } from "./api";
import { disconnectPusher } from "./realtime";

const TOKEN_KEY = "session-token";

interface SessionState {
  /** "loading" until the stored token is checked at startup. */
  status: "loading" | "signedOut" | "signedIn";
  user: User | null;
  restore: () => Promise<void>;
  signIn: (username: string, password: string, mode: "login" | "register") => Promise<void>;
  signOut: () => Promise<void>;
}

/** The signed-in user; the session token is kept in the device's secure storage. */
export const useSession = create<SessionState>((set) => ({
  status: "loading",
  user: null,

  restore: async () => {
    const token = await SecureStore.getItemAsync(TOKEN_KEY).catch(() => null);
    if (!token) return set({ status: "signedOut" });
    setApiToken(token);
    try {
      const { user } = await api.me();
      if (user) return set({ status: "signedIn", user });
      await SecureStore.deleteItemAsync(TOKEN_KEY); // expired or signed out elsewhere
    } catch (e) {
      // Offline or the server is down: keep the token and let the user retry by signing in.
      if (!(e instanceof ApiRequestError) || e.status !== 401) console.warn("Restoring the session failed:", e);
    }
    setApiToken(null);
    set({ status: "signedOut", user: null });
  },

  signIn: async (username, password, mode) => {
    const { user, token } = await (mode === "login" ? api.login : api.register)({ username, password });
    await SecureStore.setItemAsync(TOKEN_KEY, token);
    setApiToken(token);
    set({ status: "signedIn", user });
  },

  signOut: async () => {
    await api.logout().catch(() => undefined); // signing out locally matters more
    await SecureStore.deleteItemAsync(TOKEN_KEY).catch(() => undefined);
    await disconnectPusher();
    setApiToken(null);
    set({ status: "signedOut", user: null });
  },
}));
