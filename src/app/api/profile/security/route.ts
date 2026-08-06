/**
 * Password & Security: the security-setting toggles.
 *
 * Ported from `ProfileController::updateSecurity`.
 *
 * `lock_after_failed_attempts` of 0 disables the login lockout entirely; the
 * UI preset is 5, so the toggle sends 5 or 0.
 */

import { z } from "zod";
import { prisma } from "@/server/db";
import { requireUser } from "@/server/auth";
import { handle, json, parseBody } from "@/server/http";

const schema = z.object({
	twofa_on_suspicious_withdrawal: z.boolean().optional(),
	lock_after_failed_attempts: z.number().int().min(0).max(10).optional(),
});

export async function PATCH(request: Request) {
	return handle(async () => {
		const user = await requireUser(request);
		const data = await parseBody(request, schema);

		const updated = await prisma.user.update({
			where: { id: user.id },
			data: {
				...(data.twofa_on_suspicious_withdrawal !== undefined && {
					twofaOnSuspiciousWithdrawal: data.twofa_on_suspicious_withdrawal,
				}),
				...(data.lock_after_failed_attempts !== undefined && {
					lockAfterFailedAttempts: data.lock_after_failed_attempts,
				}),
			},
		});

		return json({
			twofa_on_suspicious_withdrawal: updated.twofaOnSuspiciousWithdrawal,
			lock_after_failed_attempts: updated.lockAfterFailedAttempts,
		});
	});
}
