/**
 * Seeds a demo account with projects that target the local demo site
 * (`pnpm demo:site`, http://localhost:4100).
 *
 *   pnpm db:seed            all demo projects
 *   pnpm db:seed bug-hunt   only the named project(s)
 *
 * Safe to re-run: each seeded project is recreated from scratch (with its
 * runs), and nothing else is touched.
 */
import { hash } from '@node-rs/argon2';
import { PrismaPg } from '@prisma/adapter-pg';
import { demoProjects } from '../demo-site/demo-tests.js';
import { AppConfig } from '../src/config/app-config.js';
import { Prisma, PrismaClient } from '../src/generated/prisma/client.js';
import { toStepCreateData } from '../src/test-steps/step-persistence.js';
import { testStepsSchema } from '../src/test-steps/test-step.schema.js';

const DEMO_USER = {
  email: 'demo@testpilot.dev',
  password: 'testpilot',
  name: 'Demo User',
};
const DEMO_SITE_URL = `http://localhost:${process.env.DEMO_SITE_PORT ?? 4100}`;

async function main() {
  const wanted = process.argv.slice(2);
  const unknown = wanted.filter(
    (key) => !demoProjects.some((project) => project.key === key),
  );
  if (unknown.length > 0) {
    throw new Error(
      `Unknown project "${unknown.join('", "')}". Available: ${demoProjects.map((p) => p.key).join(', ')}`,
    );
  }
  const selected = demoProjects.filter(
    (project) => wanted.length === 0 || wanted.includes(project.key),
  );

  const config = AppConfig.fromEnvironment();
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: config.databaseUrl }),
  });

  try {
    const user = await prisma.user.upsert({
      where: { email: DEMO_USER.email },
      update: {},
      create: {
        email: DEMO_USER.email,
        name: DEMO_USER.name,
        passwordHash: await hash(DEMO_USER.password),
      },
    });

    for (const demo of selected) {
      await prisma.project.deleteMany({
        where: { userId: user.id, name: demo.name },
      });

      const project = await prisma.project.create({
        data: {
          userId: user.id,
          name: demo.name,
          description: demo.description,
          environments: {
            create: {
              name: 'Local demo',
              baseUrl: DEMO_SITE_URL,
              type: 'DEVELOPMENT',
              ...(demo.signInSteps && {
                signInSteps: testStepsSchema.parse(
                  demo.signInSteps,
                ) as Prisma.InputJsonValue,
              }),
            },
          },
        },
      });

      let number = 0;
      for (const suite of demo.suites) {
        const { id: suiteId } = await prisma.testSuite.create({
          data: {
            projectId: project.id,
            name: suite.name,
            description: suite.description,
          },
        });
        for (const testCase of suite.testCases) {
          const steps = testStepsSchema.parse(testCase.steps);
          await prisma.testCase.create({
            data: {
              projectId: project.id,
              suiteId,
              number: ++number,
              title: testCase.title,
              description: testCase.description,
              priority: testCase.priority,
              category: testCase.category,
              expectedResult: testCase.expectedResult,
              startSignedIn: testCase.startSignedIn ?? false,
              createdById: user.id,
              steps: { create: toStepCreateData(steps) },
            },
          });
        }
      }
      await prisma.project.update({
        where: { id: project.id },
        data: { testCaseSeq: number },
      });

      console.log(`Seeded "${demo.name}" with ${number} test cases.`);
    }

    console.log(
      `Sign in to TestPilot as ${DEMO_USER.email} / ${DEMO_USER.password}`,
    );
    console.log(
      `Start the target site with: pnpm demo:site  (${DEMO_SITE_URL})`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

await main();
