/**
 * Response shaping.
 *
 * Laravel's `$hidden` on the User model kept `password` and `remember_token`
 * out of every JSON response automatically. Prisma has no such concept — a bare
 * `user` object serialises every column, password hash included. So every route
 * that returns a user MUST pass it through `publicUser` first.
 *
 * Field names stay snake_case to match what the frontend already reads.
 */

import type {
	ChallengeDeposit,
	Contribution,
	Group,
	GroupMember,
	Notification,
	Transaction,
	User,
	WithdrawInfo,
} from "@prisma/client";
import { publicFileUrl } from "@/server/storage";

export function publicUser(user: User) {
	return {
		id: user.id,
		name: user.name,
		tag_name: user.tagName,
		email: user.email,
		email_verified_at: user.emailVerifiedAt,
		avatar_url: publicFileUrl(user.avatarUrl),
		stellar_address: user.stellarAddress,
		date_of_birth: user.dateOfBirth,
		gender: user.gender,
		address: user.address,
		twofa_on_suspicious_withdrawal: user.twofaOnSuspiciousWithdrawal,
		lock_after_failed_attempts: user.lockAfterFailedAttempts,
		created_at: user.createdAt,
		updated_at: user.updatedAt,
		// Deliberately omitted: password, googleId, failedLoginAttempts,
		// lockedUntil. The lockout counters are internal state, and exposing
		// them tells an attacker exactly how many guesses remain.
	};
}

/** Minimal public user fields, safe to nest inside another response (e.g. a member row). */
function publicUserRef(
	user: Pick<User, "id" | "name" | "tagName" | "avatarUrl" | "stellarAddress">,
) {
	return {
		id: user.id,
		name: user.name,
		tag_name: user.tagName,
		avatar_url: publicFileUrl(user.avatarUrl),
		stellar_address: user.stellarAddress,
	};
}

/**
 * Translate a Group row to the snake_case shape the frontend was built
 * against (Laravel's Eloquent JSON, which is snake_case by default).
 *
 * THIS IS NOT OPTIONAL. A route that returns a bare Prisma `Group` object
 * silently breaks every `data.organizer_id`, `data.onchain_group_id`, etc.
 * lookup on the client — they read `undefined` instead of throwing, so the
 * failure shows up as "you're not a member" or a missing invite link rather
 * than an error. That exact bug shipped once already (see git blame on
 * `groups/[groupId]/route.ts` and `groups/route.ts`); every route that
 * returns a Group or a list of Groups MUST go through this function.
 */
export function serializeGroup(group: Group) {
	return {
		id: group.id,
		name: group.name,
		description: group.description,
		photo_url: publicFileUrl(group.photoUrl),
		organizer_id: group.organizerId,
		onchain_group_id: group.onchainGroupId,
		contract_address: group.contractAddress,
		asset_code: group.assetCode,
		asset_issuer: group.assetIssuer,
		contribution_amount: group.contributionAmount,
		target_amount: group.targetAmount,
		cycle_length_seconds: group.cycleLengthSeconds,
		contribution_frequency: group.contributionFrequency,
		fee_bps: group.feeBps,
		late_fee_bps: group.lateFeeBps,
		grace_period_hours: group.gracePeriodHours,
		late_penalty: group.latePenalty,
		payout_order: group.payoutOrder,
		group_type: group.groupType,
		auto_approve_join: group.autoApproveJoin,
		hide_balances: group.hideBalances,
		// invite_token is deliberately OMITTED here — matches Laravel's
		// `Group::$hidden = ['invite_token']`. It must only ever reach the
		// client through the organizer-gated GET /groups/[id]/invite-link
		// endpoint (which reads it off the raw Prisma row directly, not
		// through this function). Every OTHER route that returns a group is
		// visible to any approved/pending member, not just the organizer —
		// including it here would let any member mint a working invite link
		// for a circle they don't own.
		status: group.status,
		circle_kind: group.circleKind,
		savings_target: group.savingsTarget,
		challenge_ends_at: group.challengeEndsAt,
		current_cycle: group.currentCycle,
		next_recipient_id: group.nextRecipientId,
		next_payout_at: group.nextPayoutAt,
		created_at: group.createdAt,
		updated_at: group.updatedAt,
	};
}

/**
 * `serializeGroup` plus an attached `members_count`, matching Laravel's
 * `withCount('members')` naming on the list/dashboard endpoints.
 *
 * `progress` is optional so the callers that only need the count are unchanged.
 * Where it IS supplied, the card can finally show real figures: it used to
 * hardcode `current: 0`, so every card read "$0 / $0" with an empty progress bar
 * no matter how much had actually been contributed.
 */
export function serializeGroupWithCount(
	group: Group,
	membersCount: number,
	progress?: {
		youPaidTotal: string;
		youPaidThisCycle: boolean;
		approvedCount: number;
		memberAvatars: { name: string; avatar_url: string | null }[];
	},
) {
	const base = { ...serializeGroup(group), members_count: membersCount };
	if (!progress) return base;

	return {
		...base,
		approved_count: progress.approvedCount,
		member_avatars: progress.memberAvatars.map((member) => ({
			name: member.name,
			avatar_url: publicFileUrl(member.avatar_url),
		})),
		/** The viewer's cumulative confirmed contributions, decimal string. */
		you_paid_total: progress.youPaidTotal,
		/** Whether the viewer has settled the CURRENT cycle. Drives the badge. */
		you_paid_this_cycle: progress.youPaidThisCycle,
		/** Cycles in a full rotation — one turn per approved member. */
		total_cycles: progress.approvedCount,
		/**
		 * The viewer's commitment across the WHOLE rotation:
		 * `contribution_amount × total_cycles`.
		 *
		 * Deliberately NOT `target_amount`: that is a nullable, user-entered
		 * field, and being the card's only source is exactly why every card
		 * rendered a `$0` denominator.
		 *
		 * NOTE, and it is visible in the UI: a member is EXEMPT from funding
		 * their own payout (`RecipientExempt` in the savings contract), so they
		 * actually pay in only `total_cycles − 1` times. A member who never
		 * misses therefore tops out at `(n−1)/n` — 75% in a 4-person circle —
		 * and the bar never reaches 100%. Multiplying by `approvedCount - 1`
		 * instead makes it fill exactly; that is the one-line change.
		 */
		your_aim: rotationCommitment(group, progress.approvedCount),
	};
}

/** What a member pays over a full rotation: contribution × total cycles. */
function rotationCommitment(group: Group, totalCycles: number): string {
	if (totalCycles <= 0) return "0";

	// Decimal arithmetic, not float: `contributionAmount` is Decimal(20,7) and
	// multiplying it through a JS number would drift in the last places.
	return group.contributionAmount.mul(totalCycles).toString();
}

/** Translate a GroupMember row (optionally with its joined `user`) to snake_case. */
export function serializeMember(
	member: GroupMember & {
		user?: Pick<User, "id" | "name" | "tagName" | "avatarUrl" | "stellarAddress">;
	},
) {
	return {
		id: member.id,
		group_id: member.groupId,
		user_id: member.userId,
		status: member.status,
		payout_position: member.payoutPosition,
		has_received_payout: member.hasReceivedPayout,
		joined_at: member.joinedAt,
		created_at: member.createdAt,
		updated_at: member.updatedAt,
		...(member.user && { user: publicUserRef(member.user) }),
	};
}

/** Translate a Transaction row to snake_case. */
export function serializeTransaction(tx: Transaction) {
	return {
		id: tx.id,
		group_id: tx.groupId,
		user_id: tx.userId,
		type: tx.type,
		subject_type: tx.subjectType,
		subject_id: tx.subjectId,
		stellar_tx_hash: tx.stellarTxHash,
		status: tx.status,
		explorer_url: tx.explorerUrl,
		meta: tx.meta,
		created_at: tx.createdAt,
		updated_at: tx.updatedAt,
	};
}

/**
 * Translate a Notification row to snake_case.
 *
 * `dedupeKey` is deliberately NOT exposed. It is an internal idempotency key,
 * it encodes internal row ids, and nothing in the UI has any use for it.
 */
export function serializeNotification(notification: Notification) {
	return {
		id: notification.id,
		type: notification.type,
		title: notification.title,
		body: notification.body,
		href: notification.href,
		meta: notification.meta,
		read_at: notification.readAt,
		created_at: notification.createdAt,
	};
}

/** Translate a ChallengeDeposit row to snake_case. */
export function serializeChallengeDeposit(deposit: ChallengeDeposit) {
	return {
		id: deposit.id,
		group_id: deposit.groupId,
		user_id: deposit.userId,
		amount: deposit.amount,
		stellar_tx_hash: deposit.stellarTxHash,
		status: deposit.status,
		confirmed_at: deposit.confirmedAt,
		created_at: deposit.createdAt,
		updated_at: deposit.updatedAt,
	};
}

/** Translate a WithdrawInfo row to snake_case. */
export function serializeWithdrawInfo(info: WithdrawInfo) {
	return {
		id: info.id,
		user_id: info.userId,
		stellar_address: info.stellarAddress,
		memo: info.memo,
		memo_type: info.memoType,
		destination_label: info.destinationLabel,
		is_primary: info.isPrimary,
		created_at: info.createdAt,
		updated_at: info.updatedAt,
	};
}

/** Translate a Contribution row to snake_case. */
export function serializeContribution(contribution: Contribution) {
	return {
		id: contribution.id,
		group_id: contribution.groupId,
		user_id: contribution.userId,
		cycle: contribution.cycle,
		amount: contribution.amount,
		status: contribution.status,
		stellar_tx_hash: contribution.stellarTxHash,
		confirmed_at: contribution.confirmedAt,
		created_at: contribution.createdAt,
		updated_at: contribution.updatedAt,
	};
}
