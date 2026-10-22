import { Module } from '@nestjs/common';
import { ArtifactsModule } from '../artifacts/artifacts.module.js';
import { BrowserModule } from '../browser/browser.module.js';
import { ProjectsModule } from '../projects/projects.module.js';
import { TestResultsController } from './test-results.controller.js';
import { TestRunnerService } from './test-runner.service.js';
import { TestRunsController } from './test-runs.controller.js';
import { TestRunsService } from './test-runs.service.js';

@Module({
  imports: [ProjectsModule, BrowserModule, ArtifactsModule],
  controllers: [TestRunsController, TestResultsController],
  providers: [TestRunsService, TestRunnerService],
})
export class TestRunsModule {}
