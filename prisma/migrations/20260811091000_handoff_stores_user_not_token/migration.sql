-- `oauth_handoffs` stops storing live bearer tokens.
--
-- The table hashed its `code_hash` carefully and then stored the real 30-day
-- bearer token beside it in PLAINTEXT, which made the hashing pointless: the
-- table was a list of usable credentials. Hashing the token is not possible —
-- the whole point is to hand it back — so it is no longer stored at all. The
-- row now records only WHICH USER the code redeems for, and the session is
-- minted at redemption time.
--
-- Existing rows are discarded rather than migrated: a handoff code lives for 30
-- seconds, so anything in this table is already expired, and the tokens it
-- holds are exactly what should not survive this change.

DELETE FROM "oauth_handoffs";

ALTER TABLE "oauth_handoffs" DROP COLUMN "token";

ALTER TABLE "oauth_handoffs" ADD COLUMN "user_id" BIGINT NOT NULL;

ALTER TABLE "oauth_handoffs"
  ADD CONSTRAINT "oauth_handoffs_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "oauth_handoffs_user_id_idx" ON "oauth_handoffs"("user_id");
