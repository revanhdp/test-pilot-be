import { Injectable } from '@nestjs/common';
import { chromium } from 'playwright';
import { AppConfig } from '../config/app-config.js';
import { BrowserSession } from './browser-session.js';

/**
 * Entry point to browser automation. Kept behind this boundary so execution
 * can later move to a separate worker process without touching run orchestration.
 */
@Injectable()
export class BrowserService {
  constructor(private readonly config: AppConfig) {}

  async openSession(): Promise<BrowserSession> {
    const { headless, stepTimeoutMs, testTimeoutMs } = this.config.runner;
    const browser = await chromium.launch({ headless });
    return new BrowserSession(browser, { stepTimeoutMs, testTimeoutMs });
  }
}
