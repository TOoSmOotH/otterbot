import { tool } from "ai";
import { z } from "zod";
import { SshService } from "../ssh/ssh-service.js";

export function createSshExecTool() {
  return tool({
    description:
      "Execute a command on a remote host via SSH. Use ssh_list_keys to find available keys and ssh_list_hosts to see allowed hosts. Output is capped at 50KB with a 2-minute timeout.",
    parameters: z.object({
      keyId: z.string().describe("The SSH key ID to authenticate with"),
      host: z.string().describe("The remote hostname or IP to connect to (must be in the key's allowlist)"),
      command: z.string().describe("The shell command to execute on the remote host"),
      timeout: z.number().optional().describe("Timeout in milliseconds (default: 120000, max: 120000)"),
    }),
    execute: async ({ keyId, host, command, timeout }) => {
      const svc = new SshService();
      const result = svc.exec({ keyId, host, command, timeout });
      return JSON.stringify(result);
    },
  });
}
