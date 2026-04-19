export interface UserProfileFact {
  content: string;
  confidence: number;
  firstSeenAt: string;
  lastConfirmedAt: string;
  contradicted: boolean;
}

export interface UserProfile {
  name: string | null;
  preferences: UserProfileFact[];
  goals: UserProfileFact[];
  facts: UserProfileFact[];
  notes: string;
  updatedAt: string;
}

export function emptyUserProfile(): UserProfile {
  return {
    name: null,
    preferences: [],
    goals: [],
    facts: [],
    notes: "",
    updatedAt: new Date().toISOString(),
  };
}
