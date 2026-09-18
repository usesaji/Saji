/**
 * Step 2 of signup — check the code, return a single-use signup token.
 *
 * Ported from `backend/app/Http/Controllers/Auth/OtpController.php::verify`.
 *
 * The row is locked for the duration (SELECT ... FOR UPDATE via an interactive
 * transaction) so two concurrent requests cannot both consume the same attempt
 * budget or both mint a token.
 */

import { z } from "zod";
import { prisma, withTransaction } from "@/server/db";
import {
	generateSignupToken,
	hashSignupToken,
	verifyOtp,
} from "@/server/auth";
import {
	clientIp,
	handle,
	json,
	parseBody,
	rateLimit,
	validationError,
} from "@/server/http";

/** Matches OtpCode::SIGNUP_TOKEN_TTL_MINUTES. */
const SIGNUP_TOKEN_TTL_MINUTES = 30;

/** Wrong guesses allowed before the code is dead. */
const MAX_ATTEMPTS = 5;

const schema = z.object({
	email: z.string().email().max(255),
	otp: z.string().regex(/^\d{4}$/, "The otp must be 4 digits."),
});

/**
 * One message for EVERY failure mode — wrong, expired, locked out, never
 * issued — so probing cannot distinguish them.
 */
function rejectCode(): never {
	throw validationError({ otp: ["That code is invalid or has expired."] });
}

export async function POST(request: Request) {
	return handle(async () => {
		await rateLimit(`otp-verify:${clientIp(request)}`, 6, 60);

		const body = await parseBody(request, schema);
		const email = body.email.toLowerCase();

		/**
		 * A wrong code must NOT throw from inside the transaction.
		 *
		 * The previous version incremented `attempts` and then threw, both inside
		 * `withTransaction`. The throw rolls the transaction back — including the
		 * increment — so `attempts` was permanently 0 and the `lockedOut` check
		 * below could never fire. That left a 4-digit code (10,000 combinations,
		 * 10-minute TTL) defended only by an in-memory, per-instance rate limiter,
		 * i.e. brute-forceable to account takeover for any target email.
		 *
		 * So the transaction now RETURNS the outcome and the failure is recorded
		 * in its own committed statement afterwards.
		 */
		const outcome = await withTransaction(async (tx) => {
			// Lock the row so concurrent verifies serialise. Prisma has no
			// lockForUpdate() helper, so this is raw SQL — the read below then
			// sees the locked row within the same transaction.
			await tx.$queryRaw`SELECT id FROM otp_codes WHERE email = ${email} FOR UPDATE`;

			const otp = await tx.otpCode.findFirst({
				where: { email },
				orderBy: { createdAt: "desc" },
			});

			const expired = !otp || otp.expiresAt < new Date();
			const lockedOut = otp ? otp.attempts >= MAX_ATTEMPTS : false;

			if (!otp || expired || lockedOut) return { kind: "reject" as const };

			// bcrypt.compare is constant-time, so a wrong code leaks no timing
			// hint about how much of it was right.
			if (!(await verifyOtp(body.otp, otp.codeHash))) {
				return { kind: "wrong" as const, otpId: otp.id };
			}

			// Correct: mint a single-use token and clear the code so it cannot
			// be replayed.
			const token = generateSignupToken();

			await tx.otpCode.update({
				where: { id: otp.id },
				data: {
					codeHash: "",
					signupTokenHash: hashSignupToken(token),
					verifiedAt: new Date(),
					expiresAt: new Date(
						Date.now() + SIGNUP_TOKEN_TTL_MINUTES * 60_000,
					),
				},
			});

			return { kind: "ok" as const, token };
		});

		if (outcome.kind === "wrong") {
			// Outside the transaction, so this actually commits. Best-effort: a
			// failure here must still reject the code rather than accept it.
			await prisma.otpCode
				.update({
					where: { id: outcome.otpId },
					data: { attempts: { increment: 1 } },
				})
				.catch(() => {});
			rejectCode();
		}

		if (outcome.kind === "reject") rejectCode();

		return json({ message: "Email verified.", signup_token: outcome.token });
	});
}
