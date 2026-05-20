import { create } from "zustand";
import { apiFetch } from "../lib/api";
import type { UserProfile } from "@otterbot/shared";

interface UserProfileState {
  profile: UserProfile | null;
  load: () => Promise<void>;
}

export const useUserProfileStore = create<UserProfileState>((set) => ({
  profile: null,
  load: async () => {
    try {
      const res = await apiFetch("/api/user-profile");
      if (!res.ok) return;
      const profile = (await res.json()) as UserProfile;
      set({ profile });
    } catch {
      // ignore
    }
  },
}));
