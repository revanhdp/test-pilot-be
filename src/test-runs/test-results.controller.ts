import {
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
} from '@nestjs/common';
import { CurrentUser, type AuthUser } from '../auth/auth.decorators.js';
import { PrismaService } from '../database/prisma.service.js';

@Controller('test-results')
export class TestResultsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get(':id')
  async get(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const result = await this.prisma.testResult.findFirst({
      where: { id, testRun: { project: { userId: user.id } } },
      include: {
        artifacts: {
          select: { id: true, type: true, mimeType: true, sizeBytes: true },
        },
        testRun: {
          select: {
            id: true,
            number: true,
            projectId: true,
            environmentName: true,
            baseUrl: true,
            browser: true,
          },
        },
      },
    });
    if (!result) throw new NotFoundException('Test result not found');
    return result;
  }
}
