import { Module } from '@nestjs/common';
import { ArtifactStorage } from './artifact-storage.service.js';
import { ArtifactsController } from './artifacts.controller.js';

@Module({
  controllers: [ArtifactsController],
  providers: [ArtifactStorage],
  exports: [ArtifactStorage],
})
export class ArtifactsModule {}
