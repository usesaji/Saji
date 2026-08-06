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
import { prisma, type PrismaTransaction } from "@/server/db";
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
		rateLimit(`otp-verify:${clientIp(request)}`, 6, 60);

		const body = await parseBody(request, schema);
		const email = body.email.toLowerCase();

		const plainToken = await prisma.$transaction(async (tx: PrismaTransaction) => {
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

			if (!otp || expired || lockedOut) rejectCode();

			// bcrypt.compare is constant-time, so a wrong code leaks no timing
			// hint about how much of it was right.
			if (!(await verifyOtp(body.otp, otp.codeHash))) {
				await tx.otpCode.update({
					where: { id: otp.id },
					data: { attempts: { increment: 1 } },
				});
				rejectCode();
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

			return token;
		});

		return json({ message: "Email verified.", signup_token: plainToken });
	});
}
