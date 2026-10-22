import { Module } from '@nestjs/common';
import { ArtifactsModule } from './artifacts/artifacts.module.js';
import { AuthModule } from './auth/auth.module.js';
import { HealthController } from './common/health.controller.js';
import { ConfigModule } from './config/config.module.js';
import { DatabaseModule } from './database/database.module.js';
import { EnvironmentsModule } from './environments/environments.module.js';
import { ProjectsModule } from './projects/projects.module.js';
import { TestCasesModule } from './test-cases/test-cases.module.js';
import { TestRunsModule } from './test-runs/test-runs.module.js';
import { TestSuitesModule } from './test-suites/test-suites.module.js';

@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    AuthModule,
    ProjectsModule,
    EnvironmentsModule,
    TestSuitesModule,
    TestCasesModule,
    TestRunsModule,
    ArtifactsModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
