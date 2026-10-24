import { Injectable, NotFoundException } from '@nestjs/common';
import { ArtifactStorage } from '../artifacts/artifact-storage.service.js';
import { PrismaService } from '../database/prisma.service.js';
import { signInStepsData } from '../environments/sign-in-steps.js';
import type {
  CreateProjectInput,
  UpdateProjectInput,
} from './projects.schemas.js';

const DEFAULT_SUITE_NAME = 'General';

@Injectable()
export class ProjectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: ArtifactStorage,
  ) {}

  list(userId: string) {
    return this.prisma.project.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      include: {
        _count: {
          select: { environments: true, testCases: true, testRuns: true },
        },
        testRuns: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: {
            id: true,
            number: true,
            status: true,
            totalTests: true,
            passedTests: true,
            failedTests: true,
            createdAt: true,
          },
        },
      },
    });
  }

  async get(userId: string, id: string) {
    const project = await this.prisma.project.findFirst({
      where: { id, userId },
      include: {
        environments: { orderBy: { createdAt: 'asc' } },
        testSuites: {
          orderBy: { createdAt: 'asc' },
          include: { _count: { select: { testCases: true } } },
        },
        _count: { select: { testCases: true, testRuns: true } },
      },
    });
    if (!project) throw new NotFoundException('Project not found');
    return project;
  }

  /** Creates the project with a default suite and, optionally, its first environment. */
  create(userId: string, input: CreateProjectInput) {
    return this.prisma.project.create({
      data: {
        userId,
        name: input.name,
        description: input.description ?? null,
        testSuites: { create: { name: DEFAULT_SUITE_NAME } },
        ...(input.environment && {
          environments: {
            create: {
              ...input.environment,
              signInSteps: signInStepsData(input.environment.signInSteps),
            },
          },
        }),
      },
    });
  }

  async update(userId: string, id: string, input: UpdateProjectInput) {
    await this.assertAccess(userId, id);
    return this.prisma.project.update({ where: { id }, data: input });
  }

  async remove(userId: string, id: string): Promise<void> {
    await this.assertAccess(userId, id);
    const runs = await this.prisma.testRun.findMany({
      where: { projectId: id },
      select: { id: true },
    });
    await this.prisma.project.delete({ where: { id } });
    await this.storage.removeRuns(runs.map((run) => run.id));
  }

  /** Throws 404 unless the project exists and belongs to the user. */
  async assertAccess(userId: string, projectId: string): Promise<void> {
    const count = await this.prisma.project.count({
      where: { id: projectId, userId },
    });
    if (count === 0) throw new NotFoundException('Project not found');
  }
}
