import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { ProjectsService } from '../projects/projects.service.js';
import { formatTestCaseKey } from '../test-cases/test-case-key.js';
import { fromStepRow } from '../test-steps/test-step.schema.js';
import { TestRunnerService } from './test-runner.service.js';
import type {
  CreateTestRunInput,
  ListTestRunsQuery,
  TestCaseSnapshot,
} from './test-runs.schemas.js';

const testCaseForRun = {
  include: {
    steps: { orderBy: { order: 'asc' } },
    suite: { select: { name: true } },
  },
} satisfies Prisma.TestCaseDefaultArgs;

type TestCaseForRun = Prisma.TestCaseGetPayload<typeof testCaseForRun>;

@Injectable()
export class TestRunsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projects: ProjectsService,
    private readonly runner: TestRunnerService,
  ) {}

  async list(userId: string, query: ListTestRunsQuery) {
    await this.projects.assertAccess(userId, query.projectId);
    return this.prisma.testRun.findMany({
      where: { projectId: query.projectId },
      orderBy: { createdAt: 'desc' },
      take: query.limit,
      include: { triggeredBy: { select: { id: true, name: true } } },
    });
  }

  async get(userId: string, id: string) {
    const run = await this.prisma.testRun.findFirst({
      where: { id, project: { userId } },
      include: {
        project: { select: { id: true, name: true } },
        triggeredBy: { select: { id: true, name: true } },
        results: {
          orderBy: { position: 'asc' },
          include: {
            artifacts: {
              select: { id: true, type: true, mimeType: true, sizeBytes: true },
            },
          },
        },
      },
    });
    if (!run) throw new NotFoundException('Test run not found');
    return run;
  }

  async create(userId: string, input: CreateTestRunInput) {
    const environment = await this.prisma.environment.findFirst({
      where: { id: input.environmentId, project: { userId } },
    });
    if (!environment) throw new NotFoundException('Environment not found');

    const testCases = await this.selectTestCases(environment.projectId, input);
    if (testCases.length === 0) {
      throw new BadRequestException('There are no active test cases to run');
    }
    if (testCases.every((testCase) => testCase.steps.length === 0)) {
      throw new BadRequestException(
        'None of the selected test cases have steps yet',
      );
    }
    const snapshots = testCases.map((testCase) => this.snapshot(testCase));

    const run = await this.prisma.$transaction(async (tx) => {
      const { testRunSeq } = await tx.project.update({
        where: { id: environment.projectId },
        data: { testRunSeq: { increment: 1 } },
        select: { testRunSeq: true },
      });
      return tx.testRun.create({
        data: {
          projectId: environment.projectId,
          environmentId: environment.id,
          number: testRunSeq,
          environmentName: environment.name,
          baseUrl: environment.baseUrl,
          triggeredById: userId,
          totalTests: testCases.length,
          results: {
            create: testCases.map((testCase, index) => ({
              testCaseId: testCase.id,
              position: index + 1,
              testCaseSnapshot: snapshots[index] as unknown as Prisma.InputJsonValue,
            })),
          },
        },
        select: { id: true },
      });
    });

    this.runner.enqueue(run.id);
    return this.get(userId, run.id);
  }

  private async selectTestCases(
    projectId: string,
    input: CreateTestRunInput,
  ): Promise<TestCaseForRun[]> {
    if (input.testCaseIds) {
      const ids = [...new Set(input.testCaseIds)];
      const testCases = await this.prisma.testCase.findMany({
        where: { projectId, id: { in: ids }, status: { not: 'ARCHIVED' } },
        orderBy: { number: 'asc' },
        ...testCaseForRun,
      });
      if (testCases.length !== ids.length) {
        throw new NotFoundException(
          'One or more test cases were not found in this project, or are archived',
        );
      }
      return testCases;
    }

    if (input.suiteId) {
      const suite = await this.prisma.testSuite.count({
        where: { id: input.suiteId, projectId },
      });
      if (suite === 0) throw new NotFoundException('Test suite not found');
    }

    return this.prisma.testCase.findMany({
      where: { projectId, suiteId: input.suiteId, status: 'ACTIVE' },
      orderBy: { number: 'asc' },
      ...testCaseForRun,
    });
  }

  private snapshot(testCase: TestCaseForRun): TestCaseSnapshot {
    const key = formatTestCaseKey(testCase.number);
    try {
      return {
        key,
        title: testCase.title,
        suiteName: testCase.suite.name,
        priority: testCase.priority,
        category: testCase.category,
        expectedResult: testCase.expectedResult,
        steps: testCase.steps.map(fromStepRow),
      };
    } catch {
      throw new BadRequestException(
        `${key} contains a step that is no longer valid. Open the test case and save it again.`,
      );
    }
  }
}
