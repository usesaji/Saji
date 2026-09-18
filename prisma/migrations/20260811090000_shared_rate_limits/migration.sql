-- Shared rate-limit counters.
--
-- The limiter was an in-process `Map`. Serverless instances do not share
-- memory, so "6 attempts per minute" was really "6 per minute per warm
-- instance" — which under fan-out is not a limit at all, and it guarded login,
-- OTP issuance and OTP verification.
--
-- Postgres rather than Redis because this project already has a pooled
-- Postgres and adding a second datastore for four low-volume endpoints is not
-- worth the operational surface. Swapping the body of `rateLimit()` for Redis
-- later needs no call-site changes.

-- CreateTable
CREATE TABLE "rate_limits" (
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "reset_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rate_limits_pkey" PRIMARY KEY ("key")
);

-- Lets the cron sweep expired buckets without a sequential scan.
-- CreateIndex
CREATE INDEX "rate_limits_reset_at_idx" ON "rate_limits"("reset_at");
