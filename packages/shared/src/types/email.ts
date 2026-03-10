export interface EmailSummary {
  id: string;
  threadId: string;
  subject: string;
  from: string;
  to: string;
  date: string;
  snippet: string;
  labelIds: string[];
  isUnread: boolean;
}

export interface EmailDetail extends EmailSummary {
  body: string;
  cc: string;
  bcc: string;
  attachments: { filename: string; mimeType: string; size: number }[];
}

export interface EmailSettingsResponse {
  enabled: boolean;
  imapServer: string | null;
  imapPort: number;
  imapTls: boolean;
  smtpServer: string | null;
  smtpPort: number;
  smtpTls: boolean;
  username: string | null;
  passwordSet: boolean;
  fromName: string | null;
}
