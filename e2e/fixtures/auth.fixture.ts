import { test as base, expect } from "@playwright/test";
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
  // Fresh login per test context via API, then inject the cookie
  context: async ({ browser }, use) => {
    const creds = loadCredentials();
    const context = await browser.newContext({ ignoreHTTPSErrors: true });

    // Login via API to get a fresh session cookie
    const page = await context.newPage();
    await page.goto("https://localhost:62627/api/auth/login", { waitUntil: "commit" });
    // Use evaluate to POST login and capture the cookie
    const loginOk = await page.evaluate(async (passphrase) => {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passphrase }),
      });
      return res.ok;
    }, creds.setup.passphrase);

    if (!loginOk) {
      throw new Error("Failed to login during test setup");
    }

    await page.close();
    await use(context);
    await context.close();
  },

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
