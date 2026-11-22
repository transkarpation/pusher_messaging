import { create } from "zustand";
import type { Credentials, User } from "@pm/shared";
import { api } from "../api";
import { disconnectRealtime } from "../realtime";

type Status = "idle" | "loading" | "ready";

interface AuthState {
  user: User | null;
  status: Status;
  init: () => Promise<void>;
  login: (c: Credentials) => Promise<void>;
  register: (c: Credentials) => Promise<void>;
  setName: (name: string) => Promise<void>;
  uploadAvatar: (image: Blob) => Promise<void>;
  removeAvatar: () => Promise<void>;
  /** Applies a profile change made elsewhere (e.g. another tab). */
  applyUpdate: (user: User) => void;
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
  uploadAvatar: async (image) => {
    const { user } = await api.uploadAvatar(image);
    set({ user });
  },
  removeAvatar: async () => {
    const { user } = await api.removeAvatar();
    set({ user });
  },
  applyUpdate: (user) => {
    if (get().user?.id === user.id) set({ user });
  },
  logout: async () => {
    await api.logout();
    disconnectRealtime();
    set({ user: null });
  },
}));
