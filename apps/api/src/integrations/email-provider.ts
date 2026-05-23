import { logger } from "../observability/logger.js";

export type SendEmailInput = {
  to: string;
  subject: string;
  body: string;
};

export type EmailProvider = {
  send(input: SendEmailInput): Promise<void>;
};

/**
 * Dev provider: just logs the message. The existing OutboxNotifier still
 * writes a row to email_outbox for the dev /dev/email-outbox endpoint.
 */
export class LogEmailProvider implements EmailProvider {
  async send(input: SendEmailInput): Promise<void> {
    logger.info({ to: input.to, subject: input.subject }, "email send (dev)");
  }
}

/**
 * SendGrid v3 implementation. Activates when SENDGRID_API_KEY is set.
 * Uses raw fetch so no extra dependency is required.
 */
export class SendgridEmailProvider implements EmailProvider {
  constructor(
    private readonly apiKey: string,
    private readonly fromEmail: string
  ) {}

  async send(input: SendEmailInput): Promise<void> {
    const response = await fetch("https://api.sendgrid.com/v3/mail/send", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: input.to }] }],
        from: { email: this.fromEmail },
        subject: input.subject,
        content: [{ type: "text/plain", value: input.body }]
      })
    });
    if (!response.ok) {
      logger.error({ status: response.status, to: input.to }, "sendgrid send failed");
      throw new Error(`SendGrid responded ${response.status}`);
    }
  }
}
