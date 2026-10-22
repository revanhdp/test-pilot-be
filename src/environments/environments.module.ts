import { Module } from '@nestjs/common';
import { ProjectsModule } from '../projects/projects.module.js';
import { EnvironmentsController } from './environments.controller.js';
import { EnvironmentsService } from './environments.service.js';

@Module({
  imports: [ProjectsModule],
  controllers: [EnvironmentsController],
  providers: [EnvironmentsService],
  exports: [EnvironmentsService],
})
export class EnvironmentsModule {}
