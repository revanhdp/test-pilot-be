import { Module } from '@nestjs/common';
import { ProjectsModule } from '../projects/projects.module.js';
import { TestCasesController } from './test-cases.controller.js';
import { TestCasesService } from './test-cases.service.js';

@Module({
  imports: [ProjectsModule],
  controllers: [TestCasesController],
  providers: [TestCasesService],
})
export class TestCasesModule {}
