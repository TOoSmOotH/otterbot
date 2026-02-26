export type SshKeyType = "ed25519" | "rsa";

export interface SshKeyInfo {
  id: string;
  name: string;
  username: string;
  fingerprint: string;
  keyType: SshKeyType;
  allowedHosts: string[];
  port: number;
  createdAt: string;
  updatedAt: string;
}

export type SshSessionStatus = "active" | "completed" | "error";

export interface SshSession {
  id: string;
  sshKeyId: string;
  host: string;
  username: string;
  status: SshSessionStatus;
  startedAt: string;
  completedAt: string | null;
  initiatedBy: string;
}
