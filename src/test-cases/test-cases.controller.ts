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
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import {
  createTestCaseSchema,
  listTestCasesQuerySchema,
  updateTestCaseSchema,
  type CreateTestCaseInput,
  type ListTestCasesQuery,
  type UpdateTestCaseInput,
} from './test-cases.schemas.js';
import { TestCasesService } from './test-cases.service.js';

@Controller('test-cases')
export class TestCasesController {
  constructor(private readonly testCases: TestCasesService) {}

  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(listTestCasesQuerySchema))
    query: ListTestCasesQuery,
  ) {
    return this.testCases.list(user.id, query);
  }

  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createTestCaseSchema))
    input: CreateTestCaseInput,
  ) {
    return this.testCases.create(user.id, input);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.testCases.get(user.id, id);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateTestCaseSchema))
    input: UpdateTestCaseInput,
  ) {
    return this.testCases.update(user.id, id, input);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.testCases.remove(user.id, id);
  }
}
