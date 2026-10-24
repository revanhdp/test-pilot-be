-- AlterTable
ALTER TABLE "environments" ADD COLUMN     "signInSteps" JSONB;

-- AlterTable
ALTER TABLE "test_cases" ADD COLUMN     "startSignedIn" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "test_runs" ADD COLUMN     "signIn" JSONB;
