import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentUser, type AuthUser } from '../auth/auth.decorators.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import {
  createTestRunSchema,
  listTestRunsQuerySchema,
  type CreateTestRunInput,
  type ListTestRunsQuery,
} from './test-runs.schemas.js';
import { TestRunsService } from './test-runs.service.js';

@Controller('test-runs')
export class TestRunsController {
  constructor(private readonly runs: TestRunsService) {}

  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(listTestRunsQuerySchema))
    query: ListTestRunsQuery,
  ) {
    return this.runs.list(user.id, query);
  }

  /** Creates the run and queues it; poll GET /test-runs/:id for progress. */
  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createTestRunSchema)) input: CreateTestRunInput,
  ) {
    return this.runs.create(user.id, input);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.runs.get(user.id, id);
  }
}
