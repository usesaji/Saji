-- Cycle length moves from DAYS to SECONDS.
--
-- The contract has always measured `cycle_length` in seconds; the database
-- stored days and every read/write between them did a ×86400 conversion. That
-- made sub-daily cycles impossible to express and put a units bug in the path
-- of the one value that decides when money is due. Storing seconds means the
-- DB column and the on-chain field are directly comparable, which is what
-- `describeConfigMismatch` needs to verify that the terms members are shown are
-- the terms the contract enforces.
--
-- Existing rows are CONVERTED, not dropped.

-- New presets. Sub-daily options are now expressible.
ALTER TYPE "ContributionFrequency" ADD VALUE IF NOT EXISTS 'hourly';
ALTER TYPE "ContributionFrequency" ADD VALUE IF NOT EXISTS 'six_hourly';
ALTER TYPE "ContributionFrequency" ADD VALUE IF NOT EXISTS 'two_daily';
ALTER TYPE "ContributionFrequency" ADD VALUE IF NOT EXISTS 'quarterly';
ALTER TYPE "ContributionFrequency" ADD VALUE IF NOT EXISTS 'yearly';

-- Add, backfill from the old column, then drop. Never a bare DROP: the day
-- value is the only record of an existing circle's schedule.
ALTER TABLE "groups" ADD COLUMN "cycle_length_seconds" INTEGER NOT NULL DEFAULT 604800;

UPDATE "groups" SET "cycle_length_seconds" = "cycle_length_days" * 86400;

ALTER TABLE "groups" DROP COLUMN "cycle_length_days";
