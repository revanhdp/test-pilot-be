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
| Auth | Server-side sessions, Argon2 password hashing |
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
pnpm db:seed                 # demo account + "Acme Store" project with 5 test cases
pnpm demo:site               # the target website, on http://localhost:4100
```

Sign in through the web app as **demo@testpilot.dev / testpilot**.

`demo-site/` is a tiny storefront used both for trying TestPilot locally and by the integration tests. It has one deliberate bug: an invalid card number makes its payment API return HTTP 500, so the page shows a generic error instead of a validation message. Running all demo tests gives four passes and that one failure, with a screenshot.

## Scripts

| Command | Description |
| --- | --- |
| `pnpm dev` | Start the API in watch mode |
| `pnpm build` / `pnpm start:prod` | Compile to `dist/` / run the compiled API |
| `pnpm test` | Unit tests and Chromium integration tests against the demo site |
| `pnpm typecheck` / `pnpm lint` / `pnpm format` | Type-check / oxlint / Prettier |
| `pnpm db:up` / `pnpm db:down` | Start / stop PostgreSQL (Docker) |
| `pnpm prisma:migrate` | Create and apply migrations (`prisma migrate dev`) |
| `pnpm db:seed` | Recreate the demo account and project |
| `pnpm demo:site` | Serve the demo target website |
| `pnpm browsers:install` | Download Playwright Chromium |

## Configuration

Environment variables (see `.env.example`), validated at startup:

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `4001` | API port |
| `DATABASE_URL` | — | PostgreSQL connection string |
| `APP_URL` | `http://localhost:4000` | Public origin of the web app (CORS, password-reset links) |
| `SESSION_TTL_DAYS` | `14` | Session lifetime |
| `STORAGE_DIR` | `./storage` | Where screenshots and other artifacts are written |
| `RUNNER_CONCURRENCY` | `1` | Browsers running at the same time |
| `BROWSER_HEADLESS` | `true` | Run Chromium headless |
| `STEP_TIMEOUT_MS` | `10000` | Timeout for each step |
| `TEST_TIMEOUT_MS` | `120000` | Maximum duration of one test |

## Architecture

```
src/
├── auth/          register, login, logout, forgot/reset password, global session guard
├── projects/      projects (scoped to their owner)
├── environments/  target base URLs per project
├── test-suites/   grouping of test cases
├── test-cases/    test cases and their ordered steps
├── test-steps/    the step contract (Zod schema)
├── browser/       Playwright engine: step execution, navigation policy, screenshots
├── test-runs/     run creation, in-process runner, results
├── artifacts/     local artifact storage, served only to the owner
├── overview/      dashboard aggregates
├── mail/          outgoing email (logs links in development)
├── config/        validated environment configuration
├── database/      Prisma service
└── common/        validation pipe, shared schemas, health check
```

- **Auth**: opaque session tokens in an httpOnly cookie; only their SHA-256 hash is stored. A global guard protects every route not marked `@Public()`. Logging out or resetting a password revokes sessions. Auth routes are rate limited.
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

### Execution safeguards

- `navigate` can only open http(s) pages on the environment's own origin.
- Per-step timeout, per-test deadline, at most 100 steps, `wait` capped at 30 s.
- One browser per run, a fresh browser context (cookies, storage) per test.
- `RUNNER_CONCURRENCY` caps simultaneous browsers.

## API

All routes are under `/api`. Lists that belong to a project take `?projectId=`.

```
POST   /auth/register | /auth/login | /auth/logout | /auth/forgot-password | /auth/reset-password
GET    /auth/me
GET    /projects          POST /projects          GET | PATCH | DELETE /projects/:id
GET    /environments      POST /environments      GET | PATCH | DELETE /environments/:id
GET    /test-suites       POST /test-suites       GET | PATCH | DELETE /test-suites/:id
GET    /test-cases        POST /test-cases        GET | PATCH | DELETE /test-cases/:id
GET    /test-runs         POST /test-runs         GET /test-runs/:id
GET    /test-results/:id
GET    /artifacts/:id/file
GET    /overview
GET    /health
```

`POST /test-runs` takes `{ environmentId, testCaseIds? | suiteId? }` and returns the queued run immediately; poll `GET /test-runs/:id` for progress.

## Deployment notes

Designed for a small VPS (1 vCPU / 2 GB): Nginx serves the static web app and proxies `/api` to this service on `127.0.0.1:4001`. Set `NODE_ENV=production` (secure cookies) and `APP_URL` to the public origin. The API trusts the loopback proxy for client IPs.

Browser execution currently runs inside the API process: fine on a development machine; on the VPS keep `RUNNER_CONCURRENCY=1` or move execution to a separate worker.

## Known limitations

- No email provider yet: password-reset links are logged in development (and not at all in production).
- Environment URLs are not restricted to public hosts. Block private and link-local ranges before opening registration publicly.
- Per-step progress is recorded when each test finishes, not streamed live.

## Roadmap

| Phase | Scope | Status |
| --- | --- | --- |
| 1 Foundation | Auth, projects, environments | Done |
| 2 Manual testing engine | Suites, test cases, steps, Playwright runner, results | Done |
| 3 Evidence | Screenshots (done); console logs, network errors | In progress |
| 4 AI integration | Provider abstraction, Gemini, AI test generation | Next |
| 5 AI failure analysis | Evidence → LLM → structured analysis | |
| 6 Bug management | Bug reports from failures | |
| 7 AI Explorer | Agent loop over approved browser tools | |
| 8 Advanced | RAG, GitHub issues, CI/CD, parallel runs, video, traces | |
