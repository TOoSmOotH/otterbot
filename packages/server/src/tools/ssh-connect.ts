import { tool } from "ai";
import { z } from "zod";
import { SshService } from "../ssh/ssh-service.js";

/**
 * Creates the ssh_connect tool.
 * The actual PTY session setup is handled by the socket handler that intercepts
 * the tool result — this tool just validates and returns connection parameters.
 *
 * The socket handler in handlers.ts listens for ssh:connect events and creates
 * the SshPtyClient, registers it with registerPtySession(), and emits ssh:session-start.
 */
export function createSshConnectTool() {
  return tool({
    description:
      "Start an interactive SSH session to a remote host. Opens a live terminal in the SSH View that the user can watch and interact with. Use this for debugging, monitoring, or tasks that need interactive terminal access. For quick one-shot commands, prefer ssh_exec instead.",
    parameters: z.object({
      keyId: z.string().describe("The SSH key ID to authenticate with"),
      host: z.string().describe("The remote hostname or IP to connect to (must be in the key's allowlist)"),
    }),
    execute: async ({ keyId, host }) => {
      const svc = new SshService();

      // Validate key exists
      const key = svc.get(keyId);
      if (!key) {
        return JSON.stringify({ error: "SSH key not found" });
      }

      // Validate host
      const hostCheck = svc.validateHost(keyId, host);
      if (!hostCheck.ok) {
        return JSON.stringify({ error: hostCheck.error });
      }

      // The actual PTY connection is initiated by the agent framework
      // We return the validated parameters so the caller can set up the session
      return JSON.stringify({
        ok: true,
        message: `Interactive SSH session requested to ${key.username}@${host}:${key.port}. The session will appear in the SSH View.`,
        keyId,
        host,
        username: key.username,
        port: key.port,
      });
    },
  });
}
