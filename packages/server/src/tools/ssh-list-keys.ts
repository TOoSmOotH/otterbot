import { tool } from "ai";
import { z } from "zod";
import { SshService } from "../ssh/ssh-service.js";

export function createSshListKeysTool() {
  return tool({
    description:
      "List all configured SSH keys with their metadata (name, username, key type, fingerprint, allowed hosts, port).",
    parameters: z.object({}),
    execute: async () => {
      const svc = new SshService();
      const keys = svc.list();
      if (keys.length === 0) {
        return JSON.stringify({ keys: [], message: "No SSH keys configured. The user needs to add SSH keys in Settings > SSH Keys." });
      }
      return JSON.stringify({ keys });
    },
  });
}
