import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { ProjectsService } from '../projects/projects.service.js';
import type {
  CreateEnvironmentInput,
  UpdateEnvironmentInput,
} from './environments.schemas.js';

@Injectable()
export class EnvironmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projects: ProjectsService,
  ) {}

  async list(userId: string, projectId: string) {
    await this.projects.assertAccess(userId, projectId);
    return this.prisma.environment.findMany({
      where: { projectId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async get(userId: string, id: string) {
    const environment = await this.prisma.environment.findFirst({
      where: { id, project: { userId } },
    });
    if (!environment) throw new NotFoundException('Environment not found');
    return environment;
  }

  async create(userId: string, input: CreateEnvironmentInput) {
    await this.projects.assertAccess(userId, input.projectId);
    return this.prisma.environment.create({ data: input });
  }

  async update(userId: string, id: string, input: UpdateEnvironmentInput) {
    await this.get(userId, id);
    return this.prisma.environment.update({ where: { id }, data: input });
  }

  async remove(userId: string, id: string): Promise<void> {
    await this.get(userId, id);
    // Past runs keep their environment name/URL snapshot.
    await this.prisma.environment.delete({ where: { id } });
  }
}
