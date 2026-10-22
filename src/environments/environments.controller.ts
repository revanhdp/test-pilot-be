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
  createEnvironmentSchema,
  updateEnvironmentSchema,
  type CreateEnvironmentInput,
  type UpdateEnvironmentInput,
} from './environments.schemas.js';
import { EnvironmentsService } from './environments.service.js';

@Controller('environments')
export class EnvironmentsController {
  constructor(private readonly environments: EnvironmentsService) {}

  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(projectQuerySchema))
    query: { projectId: string },
  ) {
    return this.environments.list(user.id, query.projectId);
  }

  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createEnvironmentSchema))
    input: CreateEnvironmentInput,
  ) {
    return this.environments.create(user.id, input);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.environments.get(user.id, id);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateEnvironmentSchema))
    input: UpdateEnvironmentInput,
  ) {
    return this.environments.update(user.id, id, input);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.environments.remove(user.id, id);
  }
}
