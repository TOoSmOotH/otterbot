import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

export interface ProviderCredentials {
  apiKey?: string;
  baseUrl?: string;
}

export interface SearchCredentials {
  apiKey?: string;
  baseUrl?: string;
}

export interface OpenCodeCredentials {
  apiUrl: string;
  username: string;
  password: string;
}

export interface SetupCredentials {
  passphrase: string;
  provider: string;
  model: string;
  apiKey?: string;
  baseUrl?: string;
  userName: string;
  userTimezone: string;
  cooName: string;
}

export interface Credentials {
  providers: Record<string, ProviderCredentials>;
  search: Record<string, SearchCredentials>;
  opencode?: OpenCodeCredentials;
  setup: SetupCredentials;
}

const DEFAULT_SETUP: SetupCredentials = {
  passphrase: "test-passphrase-e2e",
  provider: "openai-compatible",
  model: "test-model",
  userName: "E2E Tester",
  userTimezone: "America/New_York",
  cooName: "TestCOO",
};

let cached: Credentials | null = null;

export function loadCredentials(): Credentials {
  if (cached) return cached;

  const credPath = resolve(__dirname, "../.credentials");
  if (existsSync(credPath)) {
    const raw = JSON.parse(readFileSync(credPath, "utf-8"));
    cached = {
      providers: raw.providers ?? {},
      search: raw.search ?? {},
      opencode: raw.opencode,
      setup: { ...DEFAULT_SETUP, ...raw.setup },
    };
  } else {
    cached = {
      providers: {},
      search: {},
      setup: DEFAULT_SETUP,
    };
  }

  return cached;
}

export function hasProvider(type: string): boolean {
  const creds = loadCredentials();
  return type in creds.providers && !!creds.providers[type].apiKey;
}

export function hasSearch(type: string): boolean {
  const creds = loadCredentials();
  return type in creds.search && !!creds.search[type].apiKey;
}

export function hasOpenCode(): boolean {
  const creds = loadCredentials();
  return !!creds.opencode?.apiUrl;
}
