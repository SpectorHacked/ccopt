/**
 * Weekly email delivery — MVP transport is a stub: the rendered report is
 * written to <dataDir>/outbox/ and logged. Wire a real provider (SES/Resend)
 * behind this interface when design partners exist; do not build billing or
 * real email infra before the bet survives contact (spec §6).
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface EmailSender {
  send(to: string, subject: string, html: string): Promise<void>;
}

export class OutboxEmailSender implements EmailSender {
  constructor(private dataDir: string) {}

  async send(to: string, subject: string, html: string): Promise<void> {
    const dir = join(this.dataDir, 'outbox');
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `${Date.now()}-${to.replace(/[^\w.@-]/g, '_')}.html`);
    writeFileSync(file, `<!-- To: ${to}\n     Subject: ${subject} -->\n${html}`);
    console.log(`[email] queued for ${to}: ${subject} → ${file}`);
  }
}
