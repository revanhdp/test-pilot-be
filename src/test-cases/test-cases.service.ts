import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { ProjectsService } from '../projects/projects.service.js';
import { toStepCreateData } from '../test-steps/step-persistence.js';
import type {
  CreateTestCaseInput,
  ListTestCasesQuery,
  UpdateTestCaseInput,
} from './test-cases.schemas.js';

@Injectable()
export class TestCasesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projects: ProjectsService,
  ) {}

  async list(userId: string, query: ListTestCasesQuery) {
    await this.projects.assertAccess(userId, query.projectId);
    return this.prisma.testCase.findMany({
      where: { projectId: query.projectId, suiteId: query.suiteId },
      orderBy: { number: 'asc' },
      include: {
        suite: { select: { id: true, name: true } },
        _count: { select: { steps: true } },
        results: {
          where: { status: { notIn: ['PENDING', 'RUNNING'] } },
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: {
            id: true,
            status: true,
            finishedAt: true,
            testRunId: true,
          },
        },
      },
    });
  }

  async get(userId: string, id: string) {
    const testCase = await this.prisma.testCase.findFirst({
      where: { id, project: { userId } },
      include: {
        steps: { orderBy: { order: 'asc' } },
        suite: { select: { id: true, name: true } },
        project: { select: { id: true, name: true } },
        createdBy: { select: { id: true, name: true } },
        results: {
          orderBy: { createdAt: 'desc' },
          take: 10,
          select: {
            id: true,
            status: true,
            durationMs: true,
            errorMessage: true,
            createdAt: true,
            testRun: {
              select: { id: true, number: true, environmentName: true },
            },
          },
        },
      },
    });
    if (!testCase) throw new NotFoundException('Test case not found');
    return testCase;
  }

  async create(userId: string, input: CreateTestCaseInput) {
    const suite = await this.findOwnedSuite(userId, input.suiteId);

    const id = await this.prisma.$transaction(async (tx) => {
      // Atomic increment gives each test case a unique, gap-free number per project.
      const { testCaseSeq } = await tx.project.update({
        where: { id: suite.projectId },
        data: { testCaseSeq: { increment: 1 } },
        select: { testCaseSeq: true },
      });
      const created = await tx.testCase.create({
        data: {
          projectId: suite.projectId,
          suiteId: suite.id,
          number: testCaseSeq,
          title: input.title,
          description: input.description ?? null,
          priority: input.priority,
          category: input.category,
          expectedResult: input.expectedResult ?? null,
          status: input.status,
          createdById: userId,
          steps: { create: toStepCreateData(input.steps) },
        },
        select: { id: true },
      });
      return created.id;
    });

    return this.get(userId, id);
  }

  async update(userId: string, id: string, input: UpdateTestCaseInput) {
    const existing = await this.prisma.testCase.findFirst({
      where: { id, project: { userId } },
      select: { projectId: true },
    });
    if (!existing) throw new NotFoundException('Test case not found');

    const { steps, ...fields } = input;
    if (fields.suiteId) {
      const suite = await this.findOwnedSuite(userId, fields.suiteId);
      if (suite.projectId !== existing.projectId) {
        throw new BadRequestException(
          'A test case can only be moved to a suite in the same project',
        );
      }
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.testCase.update({ where: { id }, data: fields });
      if (steps) {
        await tx.testStep.deleteMany({ where: { testCaseId: id } });
        await tx.testStep.createMany({
          data: toStepCreateData(steps).map((row) => ({ ...row, testCaseId: id })),
        });
      }
    });

    return this.get(userId, id);
  }

  async remove(userId: string, id: string): Promise<void> {
    const count = await this.prisma.testCase.count({
      where: { id, project: { userId } },
    });
    if (count === 0) throw new NotFoundException('Test case not found');
    await this.prisma.testCase.delete({ where: { id } });
  }

  private async findOwnedSuite(userId: string, suiteId: string) {
    const suite = await this.prisma.testSuite.findFirst({
      where: { id: suiteId, project: { userId } },
      select: { id: true, projectId: true },
    });
    if (!suite) throw new NotFoundException('Test suite not found');
    return suite;
  }
}
