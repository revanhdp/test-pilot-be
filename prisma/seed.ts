/**
 * Seeds a demo account with a project that targets the local demo site
 * (`pnpm demo:site`, http://localhost:4100). Safe to re-run: the demo
 * project is recreated from scratch each time.
 */
import { hash } from '@node-rs/argon2';
import { PrismaPg } from '@prisma/adapter-pg';
import { DEMO_CREDENTIALS } from '../demo-site/app.js';
import { AppConfig } from '../src/config/app-config.js';
import { PrismaClient, type Prisma } from '../src/generated/prisma/client.js';
import {
  testStepsSchema,
  toStepRows,
} from '../src/test-steps/test-step.schema.js';

const DEMO_USER = { email: 'demo@testpilot.dev', password: 'testpilot', name: 'Demo User' };
const DEMO_PROJECT = 'Acme Store';
const DEMO_SITE_URL = `http://localhost:${process.env.DEMO_SITE_PORT ?? 4100}`;

const suites = [
  {
    name: 'Smoke',
    description: 'Fast checks that the storefront is up.',
    testCases: [
      {
        title: 'Home page shows featured products',
        priority: 'MEDIUM',
        category: 'FUNCTIONAL',
        expectedResult: 'The home page loads and lists featured products.',
        steps: [
          { action: 'navigate', value: '/' },
          { action: 'assertTitle', value: 'Acme Store' },
          { action: 'assertVisible', target: { type: 'role', value: 'heading', name: 'Featured products' } },
        ],
      },
    ],
  },
  {
    name: 'Authentication',
    description: 'Sign-in flows.',
    testCases: [
      {
        title: 'Sign in with valid credentials',
        priority: 'CRITICAL',
        category: 'FUNCTIONAL',
        expectedResult: 'The user lands on their account page.',
        steps: [
          { action: 'navigate', value: '/login' },
          { action: 'fill', target: { type: 'label', value: 'Email' }, value: DEMO_CREDENTIALS.email },
          { action: 'fill', target: { type: 'label', value: 'Password' }, value: DEMO_CREDENTIALS.password },
          { action: 'click', target: { type: 'role', value: 'button', name: 'Sign in' } },
          { action: 'assertUrl', value: '/account' },
          { action: 'assertText', target: 'h1', value: 'Welcome back' },
        ],
      },
      {
        title: 'Sign in with a wrong password',
        priority: 'HIGH',
        category: 'NEGATIVE',
        expectedResult: 'An "Invalid email or password" error is shown and the user stays on the sign-in page.',
        steps: [
          { action: 'navigate', value: '/login' },
          { action: 'fill', target: '#email', value: DEMO_CREDENTIALS.email },
          { action: 'fill', target: '#password', value: 'wrong-password' },
          { action: 'click', target: { type: 'role', value: 'button', name: 'Sign in' } },
          { action: 'assertText', target: { type: 'role', value: 'alert' }, value: 'Invalid email or password' },
          { action: 'assertUrl', value: '/login' },
        ],
      },
    ],
  },
  {
    name: 'Checkout',
    description: 'Payment form behaviour.',
    testCases: [
      {
        title: 'Pay with a valid card',
        priority: 'CRITICAL',
        category: 'FUNCTIONAL',
        expectedResult: 'Payment succeeds and an order number is shown.',
        steps: [
          { action: 'navigate', value: '/checkout' },
          { action: 'fill', target: { type: 'label', value: 'Card number' }, value: '4242 4242 4242 4242' },
          { action: 'fill', target: { type: 'label', value: 'Expiry' }, value: '12/30' },
          { action: 'click', target: { type: 'role', value: 'button', name: 'Pay $49.00' } },
          { action: 'assertText', target: { type: 'role', value: 'alert' }, value: 'Payment successful' },
        ],
      },
      {
        title: 'Invalid card number shows a validation message',
        priority: 'HIGH',
        category: 'NEGATIVE',
        expectedResult: 'A "Card number is invalid" validation message appears.',
        steps: [
          { action: 'navigate', value: '/checkout' },
          { action: 'fill', target: { type: 'label', value: 'Card number' }, value: '4111 1111' },
          { action: 'fill', target: { type: 'label', value: 'Expiry' }, value: '12/30' },
          { action: 'click', target: { type: 'role', value: 'button', name: 'Pay $49.00' } },
          { action: 'assertText', target: { type: 'role', value: 'alert' }, value: 'Card number is invalid' },
        ],
      },
    ],
  },
] as const;

async function main() {
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

    await prisma.project.deleteMany({ where: { userId: user.id, name: DEMO_PROJECT } });

    const project = await prisma.project.create({
      data: {
        userId: user.id,
        name: DEMO_PROJECT,
        description: 'Demo storefront served locally by `pnpm demo:site`. Contains one deliberate checkout bug.',
        environments: {
          create: { name: 'Local demo', baseUrl: DEMO_SITE_URL, type: 'DEVELOPMENT' },
        },
      },
    });

    let number = 0;
    for (const suite of suites) {
      const { id: suiteId } = await prisma.testSuite.create({
        data: { projectId: project.id, name: suite.name, description: suite.description },
      });
      for (const testCase of suite.testCases) {
        const steps = testStepsSchema.parse(testCase.steps);
        await prisma.testCase.create({
          data: {
            projectId: project.id,
            suiteId,
            number: ++number,
            title: testCase.title,
            priority: testCase.priority,
            category: testCase.category,
            expectedResult: testCase.expectedResult,
            createdById: user.id,
            steps: {
              create: toStepRows(steps).map((row) => ({
                ...row,
                target: (row.target ?? undefined) as Prisma.InputJsonValue | undefined,
              })),
            },
          },
        });
      }
    }
    await prisma.project.update({
      where: { id: project.id },
      data: { testCaseSeq: number },
    });

    console.log(`Seeded "${DEMO_PROJECT}" with ${number} test cases.`);
    console.log(`Sign in to TestPilot as ${DEMO_USER.email} / ${DEMO_USER.password}`);
    console.log(`Start the target site with: pnpm demo:site  (${DEMO_SITE_URL})`);
  } finally {
    await prisma.$disconnect();
  }
}

await main();
