-- CreateEnum
CREATE TYPE "GroupStatus" AS ENUM ('draft', 'open', 'active', 'completed', 'cancelled');

-- CreateEnum
CREATE TYPE "CircleKind" AS ENUM ('rotating', 'challenge');

-- CreateEnum
CREATE TYPE "GroupType" AS ENUM ('public', 'private');

-- CreateEnum
CREATE TYPE "PayoutOrder" AS ENUM ('random', 'manual', 'vote', 'custom');

-- CreateEnum
CREATE TYPE "LatePenalty" AS ENUM ('deduct_from_balance', 'remove_member');

-- CreateEnum
CREATE TYPE "ContributionFrequency" AS ENUM ('daily', 'weekly', 'bi_weekly', 'monthly', 'custom');

-- CreateEnum
CREATE TYPE "MemberStatus" AS ENUM ('pending', 'approved', 'active', 'removed');

-- CreateEnum
CREATE TYPE "ContributionStatus" AS ENUM ('pending', 'submitted', 'confirmed', 'failed');

-- CreateEnum
CREATE TYPE "PayoutStatus" AS ENUM ('pending', 'submitted', 'confirmed', 'failed');

-- CreateEnum
CREATE TYPE "DepositStatus" AS ENUM ('pending', 'confirmed', 'failed');

-- CreateEnum
CREATE TYPE "TransactionType" AS ENUM ('create_group', 'join', 'contribution', 'payout', 'other');

-- CreateEnum
CREATE TYPE "TransactionStatus" AS ENUM ('pending', 'success', 'failed');

-- CreateEnum
CREATE TYPE "Gender" AS ENUM ('male', 'female', 'other', 'prefer_not_to_say');

-- CreateEnum
CREATE TYPE "MemoType" AS ENUM ('text', 'id', 'none');

-- CreateTable
CREATE TABLE "users" (
    "id" BIGSERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "tag_name" TEXT,
    "email" TEXT NOT NULL,
    "email_verified_at" TIMESTAMP(3),
    "password" TEXT,
    "google_id" TEXT,
    "avatar_url" TEXT,
    "stellar_address" TEXT,
    "date_of_birth" DATE,
    "gender" "Gender",
    "address" TEXT,
    "twofa_on_suspicious_withdrawal" BOOLEAN NOT NULL DEFAULT false,
    "lock_after_failed_attempts" SMALLINT NOT NULL DEFAULT 5,
    "failed_login_attempts" SMALLINT NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "access_tokens" (
    "id" BIGSERIAL NOT NULL,
    "user_id" BIGINT NOT NULL,
    "name" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "last_used_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "access_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "otp_codes" (
    "id" BIGSERIAL NOT NULL,
    "email" TEXT NOT NULL,
    "code_hash" TEXT NOT NULL,
    "attempts" SMALLINT NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "signup_token_hash" TEXT,
    "verified_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "otp_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "groups" (
    "id" BIGSERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "photo_url" TEXT,
    "organizer_id" BIGINT NOT NULL,
    "onchain_group_id" BIGINT,
    "contract_address" TEXT,
    "asset_code" TEXT NOT NULL DEFAULT 'USDC',
    "asset_issuer" TEXT,
    "contribution_amount" DECIMAL(20,7) NOT NULL,
    "target_amount" DECIMAL(20,7),
    "cycle_length_days" INTEGER NOT NULL DEFAULT 7,
    "contribution_frequency" "ContributionFrequency" NOT NULL DEFAULT 'weekly',
    "fee_bps" SMALLINT NOT NULL DEFAULT 0,
    "late_fee_bps" SMALLINT NOT NULL DEFAULT 0,
    "grace_period_hours" INTEGER NOT NULL DEFAULT 0,
    "late_penalty" "LatePenalty" NOT NULL DEFAULT 'deduct_from_balance',
    "payout_order" "PayoutOrder" NOT NULL DEFAULT 'manual',
    "group_type" "GroupType" NOT NULL DEFAULT 'private',
    "auto_approve_join" BOOLEAN NOT NULL DEFAULT false,
    "hide_balances" BOOLEAN NOT NULL DEFAULT false,
    "invite_token" VARCHAR(40),
    "status" "GroupStatus" NOT NULL DEFAULT 'draft',
    "circle_kind" "CircleKind" NOT NULL DEFAULT 'rotating',
    "savings_target" DECIMAL(20,7),
    "challenge_ends_at" TIMESTAMP(3),
    "current_cycle" INTEGER NOT NULL DEFAULT 0,
    "next_recipient_id" BIGINT,
    "next_payout_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "group_members" (
    "id" BIGSERIAL NOT NULL,
    "group_id" BIGINT NOT NULL,
    "user_id" BIGINT NOT NULL,
    "status" "MemberStatus" NOT NULL DEFAULT 'pending',
    "payout_position" INTEGER,
    "has_received_payout" BOOLEAN NOT NULL DEFAULT false,
    "joined_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "group_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contributions" (
    "id" BIGSERIAL NOT NULL,
    "group_id" BIGINT NOT NULL,
    "user_id" BIGINT NOT NULL,
    "cycle" INTEGER NOT NULL,
    "amount" DECIMAL(20,7) NOT NULL,
    "status" "ContributionStatus" NOT NULL DEFAULT 'pending',
    "stellar_tx_hash" TEXT,
    "confirmed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contributions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payouts" (
    "id" BIGSERIAL NOT NULL,
    "group_id" BIGINT NOT NULL,
    "recipient_id" BIGINT NOT NULL,
    "cycle" INTEGER NOT NULL,
    "gross_amount" DECIMAL(20,7) NOT NULL,
    "fee_amount" DECIMAL(20,7) NOT NULL DEFAULT 0,
    "net_amount" DECIMAL(20,7) NOT NULL,
    "status" "PayoutStatus" NOT NULL DEFAULT 'pending',
    "stellar_tx_hash" TEXT,
    "confirmed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payouts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "challenge_deposits" (
    "id" BIGSERIAL NOT NULL,
    "group_id" BIGINT NOT NULL,
    "user_id" BIGINT NOT NULL,
    "amount" DECIMAL(20,7) NOT NULL,
    "stellar_tx_hash" TEXT NOT NULL,
    "status" "DepositStatus" NOT NULL DEFAULT 'pending',
    "confirmed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "challenge_deposits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transactions" (
    "id" BIGSERIAL NOT NULL,
    "group_id" BIGINT,
    "user_id" BIGINT,
    "type" "TransactionType" NOT NULL DEFAULT 'other',
    "subject_type" TEXT,
    "subject_id" BIGINT,
    "stellar_tx_hash" TEXT,
    "status" "TransactionStatus" NOT NULL DEFAULT 'pending',
    "explorer_url" TEXT,
    "meta" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "withdraw_infos" (
    "id" BIGSERIAL NOT NULL,
    "user_id" BIGINT NOT NULL,
    "stellar_address" TEXT NOT NULL,
    "memo" TEXT,
    "memo_type" "MemoType" NOT NULL DEFAULT 'none',
    "destination_label" TEXT,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "withdraw_infos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_tag_name_key" ON "users"("tag_name");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_google_id_key" ON "users"("google_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_stellar_address_key" ON "users"("stellar_address");

-- CreateIndex
CREATE UNIQUE INDEX "access_tokens_token_hash_key" ON "access_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "access_tokens_user_id_idx" ON "access_tokens"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "otp_codes_signup_token_hash_key" ON "otp_codes"("signup_token_hash");

-- CreateIndex
CREATE INDEX "otp_codes_email_idx" ON "otp_codes"("email");

-- CreateIndex
CREATE UNIQUE INDEX "groups_onchain_group_id_key" ON "groups"("onchain_group_id");

-- CreateIndex
CREATE UNIQUE INDEX "groups_invite_token_key" ON "groups"("invite_token");

-- CreateIndex
CREATE INDEX "groups_circle_kind_idx" ON "groups"("circle_kind");

-- CreateIndex
CREATE INDEX "groups_organizer_id_idx" ON "groups"("organizer_id");

-- CreateIndex
CREATE UNIQUE INDEX "group_members_group_id_user_id_key" ON "group_members"("group_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "contributions_stellar_tx_hash_key" ON "contributions"("stellar_tx_hash");

-- CreateIndex
CREATE UNIQUE INDEX "contributions_group_id_user_id_cycle_key" ON "contributions"("group_id", "user_id", "cycle");

-- CreateIndex
CREATE UNIQUE INDEX "payouts_stellar_tx_hash_key" ON "payouts"("stellar_tx_hash");

-- CreateIndex
CREATE UNIQUE INDEX "payouts_group_id_cycle_key" ON "payouts"("group_id", "cycle");

-- CreateIndex
CREATE UNIQUE INDEX "challenge_deposits_stellar_tx_hash_key" ON "challenge_deposits"("stellar_tx_hash");

-- CreateIndex
CREATE INDEX "challenge_deposits_group_id_user_id_idx" ON "challenge_deposits"("group_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "transactions_stellar_tx_hash_key" ON "transactions"("stellar_tx_hash");

-- CreateIndex
CREATE INDEX "transactions_subject_type_subject_id_idx" ON "transactions"("subject_type", "subject_id");

-- CreateIndex
CREATE INDEX "transactions_user_id_idx" ON "transactions"("user_id");

-- CreateIndex
CREATE INDEX "withdraw_infos_user_id_idx" ON "withdraw_infos"("user_id");

-- AddForeignKey
ALTER TABLE "access_tokens" ADD CONSTRAINT "access_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "groups" ADD CONSTRAINT "groups_organizer_id_fkey" FOREIGN KEY ("organizer_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "groups" ADD CONSTRAINT "groups_next_recipient_id_fkey" FOREIGN KEY ("next_recipient_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contributions" ADD CONSTRAINT "contributions_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contributions" ADD CONSTRAINT "contributions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_recipient_id_fkey" FOREIGN KEY ("recipient_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "challenge_deposits" ADD CONSTRAINT "challenge_deposits_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "challenge_deposits" ADD CONSTRAINT "challenge_deposits_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "withdraw_infos" ADD CONSTRAINT "withdraw_infos_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
