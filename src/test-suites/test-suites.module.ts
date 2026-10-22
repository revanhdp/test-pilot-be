import { Module } from '@nestjs/common';
import { ProjectsModule } from '../projects/projects.module.js';
import { TestSuitesController } from './test-suites.controller.js';
import { TestSuitesService } from './test-suites.service.js';

@Module({
  imports: [ProjectsModule],
  controllers: [TestSuitesController],
  providers: [TestSuitesService],
})
export class TestSuitesModule {}
