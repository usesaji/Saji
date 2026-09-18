-- CreateTable
CREATE TABLE "oauth_handoffs" (
    "id" BIGSERIAL NOT NULL,
    "code_hash" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "oauth_handoffs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallet_challenges" (
    "id" BIGSERIAL NOT NULL,
    "address" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wallet_challenges_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "oauth_handoffs_code_hash_key" ON "oauth_handoffs"("code_hash");

-- CreateIndex
CREATE INDEX "oauth_handoffs_expires_at_idx" ON "oauth_handoffs"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "wallet_challenges_address_key" ON "wallet_challenges"("address");
