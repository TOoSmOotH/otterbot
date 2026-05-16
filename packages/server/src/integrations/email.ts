import nodemailer from "nodemailer";

export interface SendEmailArgs {
  to: string;
  subject: string;
  text: string;
}

/**
 * Send an email using the agent's own SMTP credentials, read from its `.env`
 * secrets map: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`.
 */
export async function sendEmail(
  secrets: Map<string, string>,
  args: SendEmailArgs
): Promise<{ messageId: string }> {
  const host = secrets.get("SMTP_HOST");
  if (!host) {
    throw new Error(
      "SMTP is not configured for this agent. Add SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS to its credentials."
    );
  }
  const port = Number(secrets.get("SMTP_PORT") ?? 587);
  const user = secrets.get("SMTP_USER");
  const pass = secrets.get("SMTP_PASS");
  const from = secrets.get("SMTP_FROM") ?? user ?? "";

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: user && pass ? { user, pass } : undefined,
  });

  const info = await transporter.sendMail({
    from,
    to: args.to,
    subject: args.subject,
    text: args.text,
  });
  return { messageId: info.messageId };
}
