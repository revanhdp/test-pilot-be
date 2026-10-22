import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import type { TestRunWhereInput } from '../generated/prisma/models.js';
import type { TestCaseSnapshot } from '../test-runs/test-runs.schemas.js';

const WINDOW_DAYS = 30;

/** Aggregates for the Overview dashboard, scoped to the user's projects. */
@Injectable()
export class OverviewService {
  constructor(private readonly prisma: PrismaService) {}

  async get(userId: string) {
    const ownRuns: TestRunWhereInput = { project: { userId } };
    const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000);

    const [
      projects,
      testCases,
      runs,
      activeRuns,
      recentRuns,
      recentFailures,
      statusCounts,
      health,
    ] = await Promise.all([
      this.prisma.project.count({ where: { userId } }),
      this.prisma.testCase.count({
        where: { project: { userId }, status: { not: 'ARCHIVED' } },
      }),
      this.prisma.testRun.count({ where: ownRuns }),
      this.prisma.testRun.findMany({
        where: { ...ownRuns, status: { in: ['PENDING', 'RUNNING'] } },
        orderBy: { createdAt: 'desc' },
        take: 3,
        include: {
          project: { select: { id: true, name: true } },
          results: {
            orderBy: { position: 'asc' },
            select: {
              id: true,
              status: true,
              position: true,
              durationMs: true,
              testCaseSnapshot: true,
            },
          },
        },
      }),
      this.prisma.testRun.findMany({
        where: ownRuns,
        orderBy: { createdAt: 'desc' },
        take: 8,
        include: { project: { select: { id: true, name: true } } },
      }),
      this.prisma.testResult.findMany({
        where: { testRun: ownRuns, status: { in: ['FAILED', 'ERROR'] } },
        orderBy: { finishedAt: 'desc' },
        take: 6,
        select: {
          id: true,
          status: true,
          errorMessage: true,
          failedStep: true,
          finishedAt: true,
          testCaseSnapshot: true,
          testRun: {
            select: {
              id: true,
              number: true,
              environmentName: true,
              project: { select: { id: true, name: true } },
            },
          },
        },
      }),
      this.prisma.testResult.groupBy({
        by: ['status'],
        where: { testRun: ownRuns, createdAt: { gte: since } },
        _count: { _all: true },
      }),
      this.prisma.testRun.findMany({
        where: { ...ownRuns, status: { in: ['PASSED', 'FAILED', 'ERROR'] } },
        orderBy: { createdAt: 'desc' },
        take: 24,
        select: {
          id: true,
          number: true,
          status: true,
          totalTests: true,
          passedTests: true,
          failedTests: true,
          skippedTests: true,
          createdAt: true,
          project: { select: { name: true } },
        },
      }),
    ]);

    const count = (status: string) =>
      statusCounts.find((row) => row.status === status)?._count._all ?? 0;
    const passed = count('PASSED');
    const executed = passed + count('FAILED') + count('ERROR');

    return {
      stats: {
        projects,
        testCases,
        runs,
        windowDays: WINDOW_DAYS,
        testsExecuted: executed,
        passRate: executed > 0 ? passed / executed : null,
      },
      activeRuns: activeRuns.map(({ results, ...run }) => ({
        ...run,
        results: results.map(({ testCaseSnapshot, ...result }) => ({
          ...result,
          testCase: summarize(testCaseSnapshot),
        })),
      })),
      recentRuns,
      recentFailures: recentFailures.map(({ testCaseSnapshot, ...result }) => ({
        ...result,
        testCase: summarize(testCaseSnapshot),
      })),
      // Oldest first, ready to plot left → right.
      health: health.reverse(),
    };
  }
}

function summarize(snapshot: unknown) {
  const { key, title } = snapshot as TestCaseSnapshot;
  return { key, title };
}
