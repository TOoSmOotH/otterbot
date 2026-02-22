# OtterBot Security Review

**Date:** February 21, 2026
**Role:** Penetration Tester / Security Architect
**Status:** **CRITICAL VULNERABILITIES IDENTIFIED**

## Executive Summary

The current codebase of OtterBot contains multiple **critical** security vulnerabilities that allow for full host compromise, arbitrary code execution, and unauthorized access. Hosting this application on the public internet in its current state is **extremely dangerous**.

The primary issues stem from:
1.  **Unprotected initial setup process.**
2.  **Multiple command injection vectors** via unsanitized user input in shell commands.
3.  **Insecure sandboxing** of custom JavaScript tools.
4.  **Insecure default configurations** (auto-approval of dangerous agent permissions).
5.  **Privilege escalation risk** due to the requirement of passwordless `sudo` for package management.

---

## Detailed Findings

### 1. Unprotected Initial Setup (Initial Access)
**Severity:** Critical
**Location:** `packages/server/src/index.ts` (`/api/setup/*` routes)

The setup wizard is publicly accessible until completed. An attacker can call `/api/setup/passphrase` to set their own passphrase and gain a valid session, then complete the setup with their own LLM provider and gain full control of the application.

**Impact:** Full application takeover on fresh or unconfigured installs.

---

### 2. Command Injection in Git Configuration
**Severity:** Critical
**Location:** `packages/server/src/github/github-service.ts`

The application uses `execSync` with template strings to configure git `user.name` and `user.email`. These values are taken directly from the user's profile settings without any validation or escaping.

```typescript
// packages/server/src/github/github-service.ts
execSync(`git -C ${targetDir} config user.name "${userName}"`, { ... });
```

An attacker can set their name to `"; touch /tmp/pwned; #"` to execute arbitrary shell commands when a repository is cloned.

**Impact:** Arbitrary code execution on the host server.
**Reproduction:** Run `reproduce_git_injection.js` (attached).

---

### 3. VM Sandbox Escape in Custom Tools
**Severity:** Critical
**Location:** `packages/server/src/tools/custom-tool-executor.ts`

Custom JavaScript tools are executed using the `node:vm` module, which is explicitly documented as not being a security sandbox. An attacker can easily escape this sandbox to access the host's `process` object and run arbitrary code.

```javascript
// Malicious tool code
const process = this.constructor.constructor('return process')();
return process.mainModule.require('child_process').execSync('id').toString();
```

**Impact:** Arbitrary code execution on the host server.
**Reproduction:** Run `reproduce_vm_escape.js` (attached).

---

### 4. Command Injection in Module Installation
**Severity:** Critical
**Location:** `packages/server/src/modules/module-installer.ts`

The module installation endpoints (`/api/modules/install`) take a `uri` parameter and pass it directly to `execSync` template strings for `git clone` and `pnpm add`.

```typescript
// packages/server/src/modules/module-installer.ts
execSync(`git clone ${sourceUri} ${targetDir}`, { ... });
execSync(`npx pnpm add ${packageName}`, { ... });
```

**Impact:** Arbitrary code execution on the host server.

---

### 5. Weak Command Blacklist in `shell_exec`
**Severity:** High
**Location:** `packages/server/src/tools/shell-exec.ts`

The `shell_exec` tool (available to Worker agents) uses a regex-based blacklist to prevent dangerous commands. This is easily bypassed using common shell techniques (e.g., using alternative binaries, encoding, or slightly different syntax).

**Impact:** Bypassing restrictions to execute prohibited system commands.

---

### 6. Auto-Approval of Dangerous Permissions
**Severity:** High
**Location:** `packages/server/src/index.ts` (`onCodingAgentPermissionRequest`)

Coding agents (like OpenCode) auto-approve permission requests after a 5-minute timeout if the user does not respond.

```typescript
const timeout = setTimeout(() => {
  // Auto-approve on timeout to prevent indefinite session hang
  console.warn(`[CodingAgent] Permission ${permission.id} timed out — auto-approving`);
  resolve("once");
}, 5 * 60 * 1000);
```

An attacker can trigger a dangerous action and simply wait 5 minutes for it to be executed.

**Impact:** Execution of dangerous operations without explicit user consent.

---

### 7. Symlink Attack in File Tools
**Severity:** High
**Location:** `packages/server/src/tools/file-read.ts` and `file-write.ts`

The `file_read` and `file_write` tools ensure that the requested path is within the workspace using `startsWith`. However, they do not resolve symlinks. An attacker can create a symlink inside the workspace pointing to a sensitive file outside the workspace (e.g., `/etc/passwd` or `.env`) and then use these tools to read or overwrite it.

**Impact:** Unauthorized reading or writing of sensitive files on the host server.
**Reproduction:** Run `reproduce_symlink_attack.js` (attached).

### 8. Root Escalation via Passwordless Sudo
**Severity:** High
**Location:** `packages/server/src/packages/packages.ts`

The package management feature requires the server to have `sudo` access for `apt-get` and `npm -g`. If the application is compromised via any of the above code execution vectors, the attacker can use these sudo-enabled commands to gain root privileges on the host or container.

---

## Recommendations

1.  **Secure the Setup Process**: Require a bootstrap token (e.g., printed to the server console on first run) to access the setup wizard.
2.  **Stop Using Template Strings for Commands**: Always use the array-based arguments version of `execFile` or `spawn` to prevent command injection. Never use `exec` or `execSync` with strings containing user input.
3.  **Use a Real Sandbox**: Use a secure sandbox like `isolated-vm` or a separate containerized environment for executing untrusted JavaScript code. `node:vm` is NOT sufficient.
4.  **Whitelist, Don't Blacklist**: For the `shell_exec` tool, use a strict whitelist of allowed commands or, preferably, run the entire agent in a heavily restricted, ephemeral container (e.g., using Docker or Podman with no network access and restricted mounts).
5.  **Remove Auto-Approval**: Never auto-approve dangerous permissions. If a timeout occurs, the default should be `reject`.
6.  **Input Validation**: Implement strict validation (e.g., using Zod) for all user-controlled settings, especially names, paths, and URLs.
7.  **Principle of Least Privilege**: Avoid using `sudo`. If package management is necessary, use a dedicated restricted user or perform installations during the build phase of the container.
8.  **Resolve Symlinks**: When validating file paths, always use `fs.realpathSync` to resolve symlinks before checking if the path is within the allowed workspace.

---

## Attached Reproduction Scripts

### `reproduce_git_injection.js`
(Tests command injection via git config)

### `reproduce_vm_escape.js`
(Tests escaping the `node:vm` sandbox)
