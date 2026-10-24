import { Body, Controller, Get, Post } from '@nestjs/common';
import { CurrentUser, type AuthUser } from '../auth/auth.decorators.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { generateTestSchema, type GenerateTestInput } from './ai.schemas.js';
import { TestGenerationService } from './test-generation.service.js';

@Controller('ai')
export class AiController {
  constructor(private readonly generation: TestGenerationService) {}

  /** Whether AI features are available, so the web app can hide or disable them. */
  @Get('status')
  status() {
    return this.generation.status();
  }

  /**
   * Proposes a test for a goal. Nothing is saved: the web app shows the steps as
   * a draft the user reviews, and the engine alone decides pass or fail.
   */
  @Post('generate-test')
  generateTest(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(generateTestSchema)) input: GenerateTestInput,
  ) {
    return this.generation.generate(user.id, input);
  }
}
