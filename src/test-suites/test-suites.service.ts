import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { ProjectsService } from '../projects/projects.service.js';
import type {
  CreateTestSuiteInput,
  UpdateTestSuiteInput,
} from './test-suites.schemas.js';

@Injectable()
export class TestSuitesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projects: ProjectsService,
  ) {}

  async list(userId: string, projectId: string) {
    await this.projects.assertAccess(userId, projectId);
    return this.prisma.testSuite.findMany({
      where: { projectId },
      orderBy: { createdAt: 'asc' },
      include: { _count: { select: { testCases: true } } },
    });
  }

  async get(userId: string, id: string) {
    const suite = await this.prisma.testSuite.findFirst({
      where: { id, project: { userId } },
      include: { _count: { select: { testCases: true } } },
    });
    if (!suite) throw new NotFoundException('Test suite not found');
    return suite;
  }

  async create(userId: string, input: CreateTestSuiteInput) {
    await this.projects.assertAccess(userId, input.projectId);
    return this.prisma.testSuite.create({
      data: {
        projectId: input.projectId,
        name: input.name,
        description: input.description ?? null,
      },
    });
  }

  async update(userId: string, id: string, input: UpdateTestSuiteInput) {
    await this.get(userId, id);
    return this.prisma.testSuite.update({ where: { id }, data: input });
  }

  /** Deletes the suite and its test cases. Past run results keep their snapshots. */
  async remove(userId: string, id: string): Promise<void> {
    await this.get(userId, id);
    await this.prisma.testSuite.delete({ where: { id } });
  }
}
