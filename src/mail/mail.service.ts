import { Injectable, Logger } from '@nestjs/common';
import { AppConfig } from '../config/app-config.js';

/**
 * Outgoing email. No provider is wired up yet: in development the message is
 * logged so flows like password reset are usable locally; in production it
 * only warns, because logging reset links would leak credentials.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  constructor(private readonly config: AppConfig) {}

  sendPasswordReset(to: string, resetUrl: string): Promise<void> {
    if (this.config.isProduction) {
      this.logger.warn(
        `Password reset requested for ${to}, but no email provider is configured.`,
      );
    } else {
      this.logger.log(`Password reset link for ${to}: ${resetUrl}`);
    }
    return Promise.resolve();
  }
}
