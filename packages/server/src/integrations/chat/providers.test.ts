import { describe, it, expect } from "vitest";
import { PROVIDERS, type ConnectorContext, type ProviderPaths } from "./providers.js";

const paths: ProviderPaths = {
  storagePath: "/tmp/otter-test/matrix/connector.json",
  cryptoStoragePath: "/tmp/otter-test/matrix/crypto-connector",
};

const noopCtx: ConnectorContext = { persistSecret: () => {} };

describe("matrix connector provider", () => {
  it("requires homeserver + username + password", () => {
    expect(PROVIDERS.matrix.connectorTokenKeys).toEqual([
      "MATRIX_HOMESERVER_URL",
      "MATRIX_USER",
      "MATRIX_PASSWORD",
    ]);
  });

  it("returns null when login credentials are incomplete", () => {
    const partial = new Map([
      ["MATRIX_HOMESERVER_URL", "https://hs"],
      ["MATRIX_USER", "bot"],
      // no password
    ]);
    expect(PROVIDERS.matrix.connectorClient(partial, paths, noopCtx)).toBeNull();
  });

  it("builds a client when homeserver + username + password are present", () => {
    const secrets = new Map([
      ["MATRIX_HOMESERVER_URL", "https://hs"],
      ["MATRIX_USER", "bot"],
      ["MATRIX_PASSWORD", "pw"],
    ]);
    expect(PROVIDERS.matrix.connectorClient(secrets, paths, noopCtx)).not.toBeNull();
  });
});
