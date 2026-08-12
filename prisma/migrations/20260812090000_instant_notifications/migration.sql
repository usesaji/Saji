-- Instant, event-driven notifications.
--
-- Raised the moment an action COMPLETES (from `after()`, at the action's own
-- call site) rather than discovered by a scheduled sweep. There is deliberately
-- no cron behind this: a sweep can only ever be as fresh as its interval, and
-- the Vercel Hobby plan caps that at once per day.
--
-- Delivery is two-legged and the legs are independent on purpose:
--   * the ROW is the user's in-app history and is always written;
--   * the EMAIL is best-effort and opt-out, and its failure must never fail
--     the action that triggered it.

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM (
    'join_requested',
    'join_approved',
    'contribution_confirmed',
    'payout_received',
    'withdrawal_sent',
    'circle_completed'
);

-- AlterTable
ALTER TABLE "users"
    ADD COLUMN "notify_by_email" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "notifications" (
    "id" BIGSERIAL NOT NULL,
    "user_id" BIGINT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "href" TEXT,
    "meta" JSONB,
    "dedupe_key" TEXT NOT NULL,
    "read_at" TIMESTAMP(3),
    "emailed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- IDEMPOTENCY, and the reason repeated reconciles do not spam.
--
-- The indexer is idempotent and re-runs on every user action plus the daily
-- sweep, so it observes the SAME completed payout many times. Without this
-- constraint each observation would raise another notification and send another
-- email. `emit()` relies on the collision here, not on a prior read.
CREATE UNIQUE INDEX "notifications_dedupe_key_key" ON "notifications"("dedupe_key");

-- Drives the bell: one user's unread, newest first.
CREATE INDEX "notifications_user_id_read_at_created_at_idx"
    ON "notifications"("user_id", "read_at", "created_at");

-- AddForeignKey
ALTER TABLE "notifications"
    ADD CONSTRAINT "notifications_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Realtime delivery
-- ---------------------------------------------------------------------------
--
-- The browser subscribes to its own rows over Supabase Realtime, so an INSERT
-- here reaches an open tab without polling.
--
-- NOTE ON RLS AND THE SERVER. Enabling RLS does NOT affect Prisma. The app
-- connects as the table's owning role, and in Postgres the owner bypasses row
-- security unless FORCE ROW LEVEL SECURITY is set — which it deliberately is
-- not. RLS here exists solely to constrain the browser's `anon`/`authenticated`
-- connection. Do not "fix" a server-side query by weakening this.
ALTER TABLE "notifications" ENABLE ROW LEVEL SECURITY;

-- This app does NOT use Supabase Auth — it has its own bearer tokens — so
-- `auth.uid()` is meaningless here. The backend mints a short-lived JWT signed
-- with the project's JWT secret carrying a `saji_user_id` claim, and the policy
-- reads that claim straight out of the request. Read explicitly from
-- `request.jwt.claims` rather than via the `auth.jwt()` helper so the policy
-- does not depend on the `auth` schema existing.
CREATE POLICY "notifications_select_own" ON "notifications"
    FOR SELECT
    TO authenticated
    USING (
        "user_id" = NULLIF(
            current_setting('request.jwt.claims', true)::jsonb ->> 'saji_user_id',
            ''
        )::bigint
    );

-- Read-only for the browser. Marking something read goes through the API, which
-- is already authenticated — the client never writes to this table directly.
GRANT SELECT ON TABLE "notifications" TO authenticated;

-- Publish to Realtime. Guarded because the publication is created by Supabase
-- and will not exist on a plain Postgres (local dev, CI), where this migration
-- must still apply cleanly.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE "notifications";
    END IF;
END $$;
