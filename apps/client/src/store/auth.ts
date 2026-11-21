import { create } from "zustand";
import type { Credentials, User } from "@pm/shared";
import { api } from "../api";
import { disconnectPusher } from "../realtime";

type Status = "idle" | "loading" | "ready";

interface AuthState {
  user: User | null;
  status: Status;
  init: () => Promise<void>;
  login: (c: Credentials) => Promise<void>;
  register: (c: Credentials) => Promise<void>;
  setName: (name: string) => Promise<void>;
  logout: () => Promise<void>;
}

export const useAuth = create<AuthState>((set, get) => ({
  user: null,
  status: "idle",

  init: async () => {
    if (get().status !== "idle") return;
    set({ status: "loading" });
    try {
      const { user } = await api.me();
      set({ user });
    } finally {
      set({ status: "ready" });
    }
  },

  // errors are rethrown so forms can display them
  login: async (c) => {
    const { user } = await api.login(c);
    set({ user });
  },
  register: async (c) => {
    const { user } = await api.register(c);
    set({ user });
  },
  setName: async (name) => {
    const { user } = await api.updateProfile({ name });
    set({ user });
  },
  logout: async () => {
    await api.logout();
    await disconnectPusher();
    set({ user: null });
  },
}));
