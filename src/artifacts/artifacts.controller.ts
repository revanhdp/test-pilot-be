import {
  Controller,
  Get,
  Header,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  StreamableFile,
} from '@nestjs/common';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { CurrentUser, type AuthUser } from '../auth/auth.decorators.js';
import { PrismaService } from '../database/prisma.service.js';
import { ArtifactStorage } from './artifact-storage.service.js';

@Controller('artifacts')
export class ArtifactsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: ArtifactStorage,
  ) {}

  /** Streams an artifact file to its owner. Artifacts are immutable, so they cache well. */
  @Get(':id/file')
  @Header('Cache-Control', 'private, max-age=86400, immutable')
  async file(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<StreamableFile> {
    const artifact = await this.prisma.artifact.findFirst({
      where: { id, testResult: { testRun: { project: { userId: user.id } } } },
    });
    if (!artifact) throw new NotFoundException('Artifact not found');

    const path = this.storage.absolute(artifact.path);
    const info = await stat(path).catch(() => null);
    if (!info?.isFile()) throw new NotFoundException('Artifact file is missing');

    return new StreamableFile(createReadStream(path), {
      type: artifact.mimeType,
      length: info.size,
    });
  }
}
