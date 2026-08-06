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

import type { User } from "@prisma/client";

export function publicUser(user: User) {
	return {
		id: user.id,
		name: user.name,
		tag_name: user.tagName,
		email: user.email,
		email_verified_at: user.emailVerifiedAt,
		avatar_url: user.avatarUrl,
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
