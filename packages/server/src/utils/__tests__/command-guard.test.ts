import { describe, it, expect } from "vitest";
import { checkBlockedCommand, normalizeCommand } from "../command-guard.js";

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
