import { Module } from '@nestjs/common';
import { BrowserModule } from '../browser/browser.module.js';
import { EnvironmentsModule } from '../environments/environments.module.js';
import { AiController } from './ai.controller.js';
import { AiRateLimiter } from './ai-rate-limiter.js';
import { GroqProvider } from './groq.provider.js';
import { LlmProvider } from './llm-provider.js';
import { TestGenerationService } from './test-generation.service.js';

@Module({
  imports: [EnvironmentsModule, BrowserModule],
  controllers: [AiController],
  providers: [
    // The one place a vendor is chosen. Swapping Groq for another provider is a change here.
    { provide: LlmProvider, useClass: GroqProvider },
    AiRateLimiter,
    TestGenerationService,
  ],
})
export class AiModule {}
