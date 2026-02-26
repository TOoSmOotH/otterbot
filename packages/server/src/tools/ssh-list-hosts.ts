import { tool } from "ai";
import { z } from "zod";
import { SshService } from "../ssh/ssh-service.js";

export function createSshListHostsTool() {
  return tool({
    description:
      "List the allowed hosts for a specific SSH key. Shows which remote hosts this key can connect to.",
    parameters: z.object({
      keyId: z.string().describe("The SSH key ID to list hosts for"),
    }),
    execute: async ({ keyId }) => {
      const svc = new SshService();
      const key = svc.get(keyId);
      if (!key) {
        return JSON.stringify({ error: "SSH key not found" });
      }
      return JSON.stringify({
        keyId: key.id,
        name: key.name,
        username: key.username,
        port: key.port,
        allowedHosts: key.allowedHosts,
      });
    },
  });
}
