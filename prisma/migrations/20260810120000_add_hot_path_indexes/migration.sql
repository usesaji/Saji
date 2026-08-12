-- Indexes for the read paths that every authenticated screen hits.
--
-- Each of these columns is filtered on a hot query but was not indexable:
-- `group_members` and `contributions` both have composite uniques that START
-- with group_id, so Postgres cannot use them to answer "what does THIS user
-- have", which is the shape of every dashboard, wallet and payout-summary
-- query. `payouts.recipient_id` had no index at all despite being filtered on
-- every dashboard render, and `transactions` indexed user_id but not group_id
-- while the circle and group-dashboard activity feeds filter by group.
--
-- Before this, loading /overview sequential-scanned contributions, payouts and
-- group_members on every request.

-- CreateIndex
CREATE INDEX "groups_status_idx" ON "groups"("status");

-- CreateIndex
CREATE INDEX "group_members_user_id_status_idx" ON "group_members"("user_id", "status");

-- CreateIndex
CREATE INDEX "contributions_user_id_status_idx" ON "contributions"("user_id", "status");

-- CreateIndex
CREATE INDEX "contributions_group_id_status_idx" ON "contributions"("group_id", "status");

-- CreateIndex
CREATE INDEX "payouts_recipient_id_idx" ON "payouts"("recipient_id");

-- CreateIndex
CREATE INDEX "transactions_group_id_idx" ON "transactions"("group_id");
