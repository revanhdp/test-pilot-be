# TestPilot AI — API

Backend for **TestPilot AI**, an AI-powered web application testing platform. It manages projects, environments and test cases, runs tests in a real Chromium browser through Playwright, and stores the results and evidence.

> Frontend: [test-pilot-fe](https://github.com/revanhdp/test-pilot-fe)

The AI layer (test generation, failure analysis, bug reports, an exploring agent) is built on top of this engine in later phases. **PASS/FAIL always comes from the browser engine, never from a model.**

## Current scope

The first working slice of the roadmap, end to end:

```
Create project → configure URL → write test steps → run → Playwright drives Chromium → PASS / FAIL → screenshot → result in the dashboard
```

## Stack

| | |
| --- | --- |
| Framework | NestJS 12 (ESM), TypeScript |
| Database | PostgreSQL 17, Prisma 7 (`@prisma/adapter-pg`) |
| Validation | Zod 4 |
| Browser automation | Playwright (Chromium) |
| Auth | Clerk (session tokens verified with `@clerk/backend`) |
| Tests | Vitest (unit + real-browser integration) |
| Tooling | pnpm, oxlint, Prettier |

## Getting started

Requirements: Node 22+, pnpm 11, Docker.

```bash
pnpm install                 # also generates the Prisma client
cp .env.example .env
pnpm db:up                   # PostgreSQL in Docker on localhost:5433
pnpm prisma:migrate          # apply migrations
pnpm browsers:install        # download Playwright Chromium
pnpm dev                     # API on http://localhost:4001/api
```

Check it is up: `curl http://localhost:4001/api/health` → `{"status":"ok"}`.

### Demo data

```bash
pnpm db:seed                 # demo account + the demo projects below
pnpm demo:site               # the target website, on http://localhost:4100
```

Sign in through the web app with a Clerk account whose **verified** email is `demo@testpilot.dev` (set `SEED_USER_EMAIL` to seed for another email). The seeded user is linked to that account on first sign-in. To seed only one project (and leave the others and their runs alone): `pnpm db:seed bug-hunt`.

`demo-site/` is a tiny storefront ("Acme Store") used both for trying TestPilot locally and by the integration tests. It ships with planted bugs, and two seeded projects test it:

| Project | What a run gives |
| --- | --- |
| **Acme Store** | 7 tests: six pass; the checkout validation test fails (an invalid card number makes the payment API return HTTP 500, so the page shows a generic error). One passing test opens a 404 page on purpose, with "Allow error status" turned on, and one starts signed in (see [Signing in once per run](#signing-in-once-per-run)) |
| **Acme Store (Bug Hunt)** | 9 tests written to fail: **8 FAILED, 1 SKIPPED**, each for a different reason |

The Bug Hunt tests, and the bug each one finds (the test description in the UI says the same):

| Test | Planted bug | Failure |
| --- | --- | --- |
| Deals page opens from the navigation | the nav links to `/deals`, which does not exist (404) | heading "Summer Deals" never appears |
| Adding a product updates the cart count | "Added to cart" is shown but the count stays 0 | expected `1`, text was `0` |
| Search field accepts a query | the field's id changed, so the test's old `#search-box` selector is stale | `fill` times out; the next step is skipped |
| Newsletter rejects an invalid email | any text is accepted as an email | expected a validation message, text was "Thanks for subscribing!" |
| Order history page loads | `/orders` crashes with HTTP 500 | the `navigate` step itself fails (`GET /orders responded with HTTP 500`); the next step is skipped |
| Sales report finishes loading | the report takes 12 s, longer than the step timeout | text was "Loading report…" |
| Admin panel requires sign-in | `/admin` has no authentication check | expected a redirect to `/login`, stayed on `/admin` |
| Product images have text alternatives | the image has no `alt` text | no image named "Trail Backpack" |
| Gift card can be redeemed | (an active test with no steps) | **SKIPPED**: "Test case has no steps" |

Each failing test waits for the step timeout (10 s by default), so the run takes about a minute and a half. Set `STEP_TIMEOUT_MS=3000` in `.env` for faster failures.

Run `pnpm demo:site:fixed` instead of `pnpm demo:site` and every bug is fixed: run the same tests again and they all pass. The integration tests (`demo-site/bug-hunt.spec.ts`) check both sides, so each failure is proven to come from the bug and not from the test.

A run's status `ERROR` is different from `FAILED`: it means the engine itself broke (for example Chromium could not start), so a buggy website cannot cause it.

## Scripts

| Command | Description |
| --- | --- |
| `pnpm dev` | Start the API in watch mode |
| `pnpm build` / `pnpm start:prod` | Compile to `dist/` / run the compiled API |
| `pnpm test` | Unit tests and Chromium integration tests against the demo site |
| `pnpm typecheck` / `pnpm lint` / `pnpm format` | Type-check / oxlint / Prettier |
| `pnpm db:up` / `pnpm db:down` | Start / stop PostgreSQL (Docker) |
| `pnpm prisma:migrate` | Create and apply migrations (`prisma migrate dev`) |
| `pnpm db:seed [project]` | Recreate the demo account and projects (`acme-store`, `bug-hunt`; none = all) |
| `pnpm demo:site` | Serve the demo target website, with its planted bugs |
| `pnpm demo:site:fixed` | Serve the same website with every bug fixed |
| `pnpm browsers:install` | Download Playwright Chromium |

## Configuration

Environment variables (see `.env.example`), validated at startup:

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `4001` | API port |
| `DATABASE_URL` | — | PostgreSQL connection string |
| `APP_URL` | `http://localhost:4000` | Public origin of the web app (CORS, and the origin Clerk tokens must be issued for) |
| `CLERK_SECRET_KEY` | — | Clerk secret key (dashboard.clerk.com → API keys). Required |
| `STORAGE_DIR` | `./storage` | Where screenshots and other artifacts are written |
| `RUNNER_CONCURRENCY` | `1` | Browsers running at the same time |
| `BROWSER_HEADLESS` | `true` | Run Chromium headless |
| `STEP_TIMEOUT_MS` | `10000` | Timeout for each step |
| `TEST_TIMEOUT_MS` | `120000` | Maximum duration of one test |
| `GROQ_API_KEY` | — | Enables AI test generation. A free key from console.groq.com; without it AI endpoints answer `AI_NOT_CONFIGURED` and nothing else changes |
| `GROQ_MODEL` | `openai/gpt-oss-120b` | Needs strict JSON Schema support (`gpt-oss-20b`/`120b`) |
| `AI_GENERATIONS_PER_HOUR` | `10` | Per-user cap, in memory |

## Architecture

```
src/
├── auth/          Clerk token guard, local user provisioning, `GET /auth/me`
├── projects/      projects (scoped to their owner)
├── environments/  target base URLs per project
├── test-suites/   grouping of test cases
├── test-cases/    test cases and their ordered steps
├── test-steps/    the step contract (Zod schema)
├── browser/       Playwright engine: step execution, navigation policy, screenshots
├── ai/            LLM provider (Groq), AI test generation, per-user limit
├── test-runs/     run creation, in-process runner, results
├── artifacts/     local artifact storage, served only to the owner
├── overview/      dashboard aggregates
├── config/        validated environment configuration
├── database/      Prisma service
└── common/        validation pipe, shared schemas, health check
```

- **Auth**: [Clerk](https://clerk.com) owns sign-in, sign-up, passwords and sessions. A global guard protects every route not marked `@Public()`: it verifies the Clerk session token (`Authorization: Bearer`) and checks it was issued for `APP_URL`. The API can live on another origin than the web app: CORS allows `APP_URL` with credentials, and no cookie is used for auth. The first request of a Clerk user creates the local `users` row; a seeded or migrated user (`clerkId` = `pending:<email>`) is linked by email, only when Clerk reports that email as verified.
- **Authorization**: every query is scoped through `project.userId`. Another user's resources return 404.
- **Runs**: creating a run snapshots each test case, so later edits don't change past results. Runs execute in-process with bounded concurrency; a run interrupted by a restart is marked `ERROR` on the next boot. `BrowserService` / `TestRunnerService` is the boundary where a queue and a separate worker plug in later.

### The step contract

Steps are data, never code. Everything is validated before it is stored or executed — the same schema future LLM output will be checked against.

```json
{ "action": "navigate", "value": "/login" }
{ "action": "fill", "target": { "type": "label", "value": "Email" }, "value": "demo@acme.test" }
{ "action": "click", "target": { "type": "role", "value": "button", "name": "Sign in" } }
{ "action": "assertText", "target": "#form-error", "value": "Invalid email or password" }
```

- **Actions**: `navigate`, `click`, `fill`, `select`, `check`, `uncheck`, `press`, `wait`, `assertVisible`, `assertHidden`, `assertText`, `assertUrl`, `assertTitle`
- **Locators**: `css`, `text`, `role` (+ accessible `name`), `label`, `placeholder`, `testId`. A bare string target is shorthand for CSS.
- **Options**: `navigate` takes `allowErrorStatus` (boolean, default false), stored in the step's `options` column.

### Signing in once per run

Tests of pages behind a login don't each need their own sign-in steps:

- An environment can have **sign-in steps** (`signInSteps`, same step contract, at most 30). End them with an assertion that proves the sign-in worked, such as `assertUrl /account`.
- A test case with **`startSignedIn: true`** begins with the session those steps leave behind. Tests of the sign-in page itself, or of what signed-out visitors see, leave it off.
- When a run contains signed-in tests, the runner performs the sign-in steps **once**, before any test, and keeps the session (cookies and local storage, Playwright's `storageState`) **in memory only**. Each signed-in test still gets its own fresh context, seeded with a copy of that session.
- If the sign-in fails, every signed-in test **fails** with the reason (`Sign-in failed at step 5: …`) and a screenshot of the sign-in page; its own steps are marked skipped. A broken sign-in is a real failure, so it can't turn a run green. Signed-out tests run as usual.
- Creating a run refuses signed-in tests when the environment has no sign-in steps.
- The sign-in steps are frozen on the run (`signIn`), with their outcome. Typed values are replaced by `••••••` in run responses and left out of run lists. They are still stored as plain text in the environment, so use a dedicated test account.
- Sessions can expire during a long run, and a test that signs out can end the shared session on the server: such tests should sign in with their own steps.

### Execution safeguards

- `navigate` can only open http(s) pages on the environment's own origin.
- `navigate` fails when the page answers HTTP 4xx/5xx (judged on the page finally reached, after redirects). A test that opens an error page on purpose sets `allowErrorStatus: true` on that step. Clicking a link is not checked this way: use an assertion after it.
- Per-step timeout, per-test deadline, at most 100 steps, `wait` capped at 30 s.
- One browser per run, a fresh browser context (cookies, storage) per test. Signed-in tests start from a copy of the run's session, which never leaves memory.
- `RUNNER_CONCURRENCY` caps simultaneous browsers.

## AI test generation

`POST /api/ai/generate-test` `{ environmentId, goal, path? }` proposes a test for a goal. **Nothing is saved**: the response is a draft (`title`, `expectedResult`, `steps`) for a person to review, and the browser engine still alone decides PASS/FAIL. `GET /api/ai/status` says whether AI is available.

1. The page at `path` is opened (same origin rule as `navigate`, signed out) and reduced to its **accessibility tree** (roles and accessible names), so the model picks real elements instead of guessing selectors.
2. The model answers in strict JSON Schema; the answer is converted to steps and **validated by the same schema as hand-written steps**. An invalid answer gets one repair attempt.
3. The draft's actions (up to its first assertion) are tried on the page in a throwaway browser, the page *after* them is read, and the model rewrites the assertions to check what the **goal** says should happen, not what the page currently does (a page that shows "Thanks!" for an invalid email must make the test fail). `refined: false` plus a warning says when this stage could not run.

The provider sits behind `LlmProvider`; Groq is chosen in `ai.module.ts` only. Free-tier rules:

- A used-up provider limit (HTTP 429) **stops**: no retry loop and no fallback to another provider, so nothing is ever billed. The error is `AI_QUOTA_EXHAUSTED` with `retryAfterSeconds`. Keep the Groq account on the Free tier (no payment method) to make that a hard guarantee.
- Groq's free tier allows 8,000 tokens per minute, so prompts are kept small (the outline is capped, a generation uses about 2,000 tokens).
- `AI_USER_LIMIT` (429) is the per-user hourly cap; attempts that never reached the model are not counted. Other errors: `AI_NOT_CONFIGURED` (503), `AI_PAGE_UNREACHABLE` (422), `AI_PROVIDER_ERROR` / `AI_BAD_OUTPUT` (502).
- Never put real credentials in a goal: it is sent to the provider. Free tiers may use submitted data to improve their models.

## API

All routes are under `/api`. Lists that belong to a project take `?projectId=`.

```
GET    /auth/me
GET    /projects          POST /projects          GET | PATCH | DELETE /projects/:id
GET    /environments      POST /environments      GET | PATCH | DELETE /environments/:id
GET    /test-suites       POST /test-suites       GET | PATCH | DELETE /test-suites/:id
GET    /test-cases        POST /test-cases        GET | PATCH | DELETE /test-cases/:id
GET    /test-runs         POST /test-runs         GET /test-runs/:id
GET    /test-results/:id
GET    /artifacts/:id/file
GET    /overview
GET    /ai/status         POST /ai/generate-test
GET    /health
```

`POST /test-runs` takes `{ environmentId, testCaseIds? | suiteId? }` and returns the queued run immediately; poll `GET /test-runs/:id` for progress.

## Deployment notes

Designed for a small VPS (1 vCPU / 2 GB): Nginx serves the static web app and proxies `/api` to this service on `127.0.0.1:4001`. Set `NODE_ENV=production` and `APP_URL` to the public origin. The API trusts the loopback proxy for client IPs.

To serve the API from its own origin instead (e.g. `https://api.example.com`), build the web app with `NUXT_PUBLIC_API_BASE=https://api.example.com` and keep `APP_URL` at the web app's origin: it is the only CORS origin and the only origin Clerk tokens are accepted for. Add the web origin to the Clerk instance's allowed origins.

Browser execution currently runs inside the API process: fine on a development machine; on the VPS keep `RUNNER_CONCURRENCY=1` or move execution to a separate worker.

## Known limitations

- Environment URLs are not restricted to public hosts. Block private and link-local ranges before opening registration publicly.
- Per-step progress is recorded when each test finishes, not streamed live.

## Roadmap

| Phase | Scope | Status |
| --- | --- | --- |
| 1 Foundation | Auth, projects, environments | Done |
| 2 Manual testing engine | Suites, test cases, steps, Playwright runner, results | Done |
| 3 Evidence | Screenshots (done); console logs, network errors | In progress |
| 4 AI integration | Provider abstraction, Groq, AI test generation | In progress (API done) |
| 5 AI failure analysis | Evidence → LLM → structured analysis | |
| 6 Bug management | Bug reports from failures | |
| 7 AI Explorer | Agent loop over approved browser tools | |
| 8 Advanced | RAG, GitHub issues, CI/CD, parallel runs, video, traces | |
