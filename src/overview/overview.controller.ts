import { Controller, Get } from '@nestjs/common';
import { CurrentUser, type AuthUser } from '../auth/auth.decorators.js';
import { OverviewService } from './overview.service.js';

@Controller('overview')
export class OverviewController {
  constructor(private readonly overview: OverviewService) {}

  @Get()
  get(@CurrentUser() user: AuthUser) {
    return this.overview.get(user.id);
  }
}
