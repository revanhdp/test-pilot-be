import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentUser, type AuthUser } from '../auth/auth.decorators.js';
import { projectQuerySchema } from '../common/schemas.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import {
  createTestSuiteSchema,
  updateTestSuiteSchema,
  type CreateTestSuiteInput,
  type UpdateTestSuiteInput,
} from './test-suites.schemas.js';
import { TestSuitesService } from './test-suites.service.js';

@Controller('test-suites')
export class TestSuitesController {
  constructor(private readonly suites: TestSuitesService) {}

  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(projectQuerySchema))
    query: { projectId: string },
  ) {
    return this.suites.list(user.id, query.projectId);
  }

  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createTestSuiteSchema))
    input: CreateTestSuiteInput,
  ) {
    return this.suites.create(user.id, input);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.suites.get(user.id, id);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateTestSuiteSchema))
    input: UpdateTestSuiteInput,
  ) {
    return this.suites.update(user.id, id, input);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.suites.remove(user.id, id);
  }
}
