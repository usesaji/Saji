/**
 * Step 1 of signup — issue an OTP.
 *
 * Ported from `backend/app/Http/Controllers/Auth/OtpController.php::start`.
 *
 * Responds IDENTICALLY whether or not the email is already registered, so this
 * endpoint cannot be used to enumerate accounts. When the address is taken we
 * simply skip sending. Do not "helpfully" add an "email already registered"
 * branch here — that is the enumeration hole this shape exists to close.
 */

import { z } from "zod";
import { prisma, withTransaction } from "@/server/db";
import { generateOtp, hashOtp } from "@/server/auth";
import { clientIp, handle, json, parseBody, rateLimit } from "@/server/http";
import { sendOtpEmail } from "@/server/mail";

/** Matches OtpCode::TTL_MINUTES in the Laravel model. */
const TTL_MINUTES = 10;

const schema = z.object({
	email: z.string().email().max(255),
});

export async function POST(request: Request) {
	return handle(async () => {
		// Laravel had `throttle:6,1` on this route: 6 requests per minute. These
		// endpoints mail codes, so they are the natural target for mail-bombing.
		await rateLimit(`otp-start:${clientIp(request)}`, 6, 60);

		const { email: rawEmail } = await parseBody(request, schema);
		const email = rawEmail.toLowerCase();

		const existing = await prisma.user.findUnique({ where: { email } });

		if (!existing) {
			const code = generateOtp();

			const expiresAt = new Date(Date.now() + TTL_MINUTES * 60_000);

			// One live code per address: drop any previous, unverified request.
			// Uses withTransaction (retries on P2028) rather than the array-batch
			// form — Prisma's batch $transaction still opens a single BEGIN/COMMIT
			// around both statements, so it has the same pooler session-affinity
			// requirement as the interactive form, just without the callback.
			const codeHash = await hashOtp(code);
			await withTransaction(async (tx) => {
				await tx.otpCode.deleteMany({ where: { email } });
				await tx.otpCode.create({ data: { email, codeHash, expiresAt } });
			});

			await sendOtpEmail(email, code, TTL_MINUTES);
		}

		return json({
			message: "If that address can be registered, a code has been sent.",
			expires_in_minutes: TTL_MINUTES,
		});
	});
}
