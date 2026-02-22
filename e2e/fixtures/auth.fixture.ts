import { test as base } from "@playwright/test";
import {
  loadCredentials,
  hasProvider,
  hasSearch,
  hasOpenCode,
  type Credentials,
} from "../credentials";

type AuthFixtures = {
  credentials: Credentials;
  requireProvider: (type: string) => void;
  requireSearch: (type: string) => void;
  requireOpenCode: () => void;
  authedPage: import("@playwright/test").Page;
};

export const test = base.extend<AuthFixtures>({
  credentials: async ({}, use) => {
    await use(loadCredentials());
  },

  requireProvider: async ({}, use, testInfo) => {
    await use((type: string) => {
      if (!hasProvider(type)) {
        testInfo.skip(true, `No credentials for provider: ${type}`);
      }
    });
  },

  requireSearch: async ({}, use, testInfo) => {
    await use((type: string) => {
      if (!hasSearch(type)) {
        testInfo.skip(true, `No credentials for search: ${type}`);
      }
    });
  },

  requireOpenCode: async ({}, use, testInfo) => {
    await use(() => {
      if (!hasOpenCode()) {
        testInfo.skip(true, "No OpenCode credentials configured");
      }
    });
  },
});

export { expect } from "@playwright/test";
