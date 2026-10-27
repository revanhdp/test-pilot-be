-- Auth moves to Clerk. Existing users keep their data: they get a placeholder
-- clerkId and are linked to their Clerk account by verified email on first sign-in.
ALTER TABLE "users" ADD COLUMN "clerkId" TEXT;
UPDATE "users" SET "clerkId" = 'pending:' || "email";
ALTER TABLE "users" ALTER COLUMN "clerkId" SET NOT NULL;
ALTER TABLE "users" DROP COLUMN "passwordHash";

DROP TABLE "sessions";
DROP TABLE "password_reset_tokens";

CREATE UNIQUE INDEX "users_clerkId_key" ON "users"("clerkId");
