import type { TestCategory, TestPriority } from '../src/generated/prisma/enums.js';
import { DEMO_CREDENTIALS } from './app.js';

/** Test case definitions for the demo site. Steps are validated by the step schema when used. */
export interface DemoTestCase {
  title: string;
  priority: TestPriority;
  category: TestCategory;
  description?: string;
  expectedResult: string;
  steps: unknown[];
}

export interface DemoSuite {
  name: string;
  description: string;
  testCases: DemoTestCase[];
}

export interface DemoProject {
  /** Short name used to seed a single project: `pnpm db:seed bug-hunt`. */
  key: string;
  name: string;
  description: string;
  suites: DemoSuite[];
}

const button = (name: string) => ({ type: 'role', value: 'button', name });
const heading = (name: string) => ({ type: 'role', value: 'heading', name });
const label = (value: string) => ({ type: 'label', value });

/** The baseline project: mostly passing, with a single failing checkout test. */
const acmeStore: DemoProject = {
  key: 'acme-store',
  name: 'Acme Store',
  description:
    'Demo storefront served locally by `pnpm demo:site`. Five tests pass; the checkout validation test fails because of a planted bug.',
  suites: [
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
            { action: 'assertVisible', target: heading('Featured products') },
          ],
        },
        {
          title: 'Unknown URL shows the custom 404 page',
          priority: 'LOW',
          category: 'EDGE_CASE',
          description:
            'Navigate fails on HTTP 4xx/5xx by default. This test opens a page that is meant to answer 404, so the step has "Allow error status" turned on and the test checks the error page itself.',
          expectedResult: 'The "Page not found" page is shown.',
          steps: [
            { action: 'navigate', value: '/this-page-does-not-exist', allowErrorStatus: true },
            { action: 'assertVisible', target: heading('Page not found') },
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
            { action: 'fill', target: label('Email'), value: DEMO_CREDENTIALS.email },
            { action: 'fill', target: label('Password'), value: DEMO_CREDENTIALS.password },
            { action: 'click', target: button('Sign in') },
            { action: 'assertUrl', value: '/account' },
            { action: 'assertText', target: 'h1', value: 'Welcome back' },
          ],
        },
        {
          title: 'Sign in with a wrong password',
          priority: 'HIGH',
          category: 'NEGATIVE',
          expectedResult:
            'An "Invalid email or password" error is shown and the user stays on the sign-in page.',
          steps: [
            { action: 'navigate', value: '/login' },
            { action: 'fill', target: '#email', value: DEMO_CREDENTIALS.email },
            { action: 'fill', target: '#password', value: 'wrong-password' },
            { action: 'click', target: button('Sign in') },
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
            { action: 'fill', target: label('Card number'), value: '4242 4242 4242 4242' },
            { action: 'fill', target: label('Expiry'), value: '12/30' },
            { action: 'click', target: button('Pay $49.00') },
            { action: 'assertText', target: { type: 'role', value: 'alert' }, value: 'Payment successful' },
          ],
        },
        {
          title: 'Invalid card number shows a validation message',
          priority: 'HIGH',
          category: 'NEGATIVE',
          description:
            'Planted bug: an invalid card number makes the payment API answer HTTP 500, so the page shows a generic error instead of a validation message.',
          expectedResult: 'A "Card number is invalid" validation message appears.',
          steps: [
            { action: 'navigate', value: '/checkout' },
            { action: 'fill', target: label('Card number'), value: '4111 1111' },
            { action: 'fill', target: label('Expiry'), value: '12/30' },
            { action: 'click', target: button('Pay $49.00') },
            { action: 'assertText', target: { type: 'role', value: 'alert' }, value: 'Card number is invalid' },
          ],
        },
      ],
    },
  ],
};

/**
 * Tests written to fail: every case hits a different planted bug, so a run
 * produces failures of every kind (plus one skipped test). Run the site with
 * `pnpm demo:site:fixed` and the same tests all pass.
 */
const bugHunt: DemoProject = {
  key: 'bug-hunt',
  name: 'Acme Store (Bug Hunt)',
  description:
    'The same demo storefront, with tests designed to fail. Each test description names the planted bug. Start the site with `pnpm demo:site:fixed` to see them pass.',
  suites: [
    {
      name: 'Shopping',
      description: 'Browsing and the cart.',
      testCases: [
        {
          title: 'Deals page opens from the navigation',
          priority: 'HIGH',
          category: 'FUNCTIONAL',
          description:
            'Planted bug: the "Deals" link is in the navigation, but /deals does not exist and answers 404.',
          expectedResult: 'The "Summer Deals" page opens.',
          steps: [
            { action: 'navigate', value: '/' },
            { action: 'click', target: { type: 'role', value: 'link', name: 'Deals' } },
            { action: 'assertVisible', target: heading('Summer Deals') },
          ],
        },
        {
          title: 'Adding a product updates the cart count',
          priority: 'CRITICAL',
          category: 'FUNCTIONAL',
          description:
            'Planted bug: clicking "Add to cart" shows "Added to cart ✓" but the cart count in the header stays at 0.',
          expectedResult: 'The cart count in the header becomes 1.',
          steps: [
            { action: 'navigate', value: '/' },
            { action: 'click', target: button('Add Trail Backpack to cart') },
            { action: 'assertText', target: '#cart-count', value: '1' },
          ],
        },
        {
          title: 'Search field accepts a query',
          priority: 'MEDIUM',
          category: 'REGRESSION',
          description:
            'Planted bug: the search field\'s id changed from #search-box to #search-input, so this test, which still uses the old id, can no longer find it. Fix the test by locating the field by its label instead of a CSS id.',
          expectedResult: 'The query is typed into the search field and submitted.',
          steps: [
            { action: 'navigate', value: '/' },
            { action: 'fill', target: '#search-box', value: 'backpack' },
            { action: 'press', value: 'Enter' },
          ],
        },
      ],
    },
    {
      name: 'Forms',
      description: 'Validation of user input.',
      testCases: [
        {
          title: 'Newsletter rejects an invalid email',
          priority: 'HIGH',
          category: 'NEGATIVE',
          description:
            'Planted bug: the newsletter form accepts any text as an email address and says "Thanks for subscribing!".',
          expectedResult: 'A validation message "Enter a valid email address" appears.',
          steps: [
            { action: 'navigate', value: '/newsletter' },
            { action: 'fill', target: label('Email'), value: 'not-an-email' },
            { action: 'click', target: button('Subscribe') },
            { action: 'assertText', target: '#newsletter-message', value: 'valid email' },
          ],
        },
      ],
    },
    {
      name: 'Reliability',
      description: 'Server errors and slow pages.',
      testCases: [
        {
          title: 'Order history page loads',
          priority: 'HIGH',
          category: 'FUNCTIONAL',
          description:
            'Planted bug: /orders crashes on the server and answers HTTP 500. The navigate step itself fails, so the step after it is skipped.',
          expectedResult: 'The "Your orders" page is shown.',
          steps: [
            { action: 'navigate', value: '/orders' },
            { action: 'assertVisible', target: heading('Your orders') },
          ],
        },
        {
          title: 'Sales report finishes loading',
          priority: 'MEDIUM',
          category: 'FUNCTIONAL',
          description:
            'Planted bug: the report takes 12 seconds to load, longer than the step timeout (10 s by default).',
          expectedResult: 'The report status changes to "Report ready" in a reasonable time.',
          steps: [
            { action: 'navigate', value: '/reports' },
            { action: 'assertText', target: '#report-status', value: 'Report ready' },
          ],
        },
      ],
    },
    {
      name: 'Security & accessibility',
      description: 'Access control and assistive technology.',
      testCases: [
        {
          title: 'Admin panel requires sign-in',
          priority: 'CRITICAL',
          category: 'SECURITY',
          description:
            'Planted bug: /admin has no authentication check, so anyone can open it and see the list of users.',
          expectedResult: 'A signed-out visitor is redirected to the sign-in page.',
          steps: [
            { action: 'navigate', value: '/admin' },
            { action: 'assertUrl', value: '/login' },
          ],
        },
        {
          title: 'Product images have text alternatives',
          priority: 'MEDIUM',
          category: 'ACCESSIBILITY',
          description: 'Planted bug: the Trail Backpack image has no alt text, so screen readers cannot describe it.',
          expectedResult: 'The product image is exposed to assistive technology as "Trail Backpack".',
          steps: [
            { action: 'navigate', value: '/' },
            { action: 'assertVisible', target: { type: 'role', value: 'img', name: 'Trail Backpack' } },
          ],
        },
      ],
    },
    {
      name: 'Planned',
      description: 'Tests that are written but not finished.',
      testCases: [
        {
          title: 'Gift card can be redeemed',
          priority: 'LOW',
          category: 'FUNCTIONAL',
          description:
            'An active test case with no steps yet. It is not executed; the run reports it as skipped.',
          expectedResult: 'The gift card balance is applied to the order.',
          steps: [],
        },
      ],
    },
  ],
};

export const demoProjects: DemoProject[] = [acmeStore, bugHunt];

/** Every test case of the Bug Hunt project. */
export const bugHuntCases = bugHunt.suites.flatMap((suite) => suite.testCases);
