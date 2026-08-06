/**
 * Transactional email via Resend, replacing Laravel's Mail facade.
 *
 * Uses Resend's REST API over `fetch` rather than the SDK — one less dependency
 * for two endpoints, and it works unchanged on any runtime.
 *
 * `MAIL_FROM_ADDRESS`'s domain MUST be verified in the Resend account that owns
 * `RESEND_API_KEY`, or every send fails with a 403 and OTP signup breaks. This
 * is the same constraint the Laravel deployment had.
 */

const RESEND_ENDPOINT = "https://api.resend.com/emails";

function config() {
	const apiKey = process.env.RESEND_API_KEY ?? "";
	const from = process.env.MAIL_FROM_ADDRESS ?? "";
	const fromName = process.env.MAIL_FROM_NAME ?? "Saji";

	return { apiKey, from: from ? `${fromName} <${from}>` : "", fromName };
}

async function send(to: string, subject: string, html: string): Promise<void> {
	const { apiKey, from } = config();

	// In development, log instead of sending so signup works without Resend
	// configured. Mirrors Laravel's `MAIL_MAILER=log`.
	if (!apiKey || !from) {
		if (process.env.NODE_ENV === "production") {
			throw new Error(
				"RESEND_API_KEY and MAIL_FROM_ADDRESS must be set to send mail.",
			);
		}
		console.info(`[mail] would send to ${to}: ${subject}\n${html}`);
		return;
	}

	const response = await fetch(RESEND_ENDPOINT, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${apiKey}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({ from, to, subject, html }),
	});

	if (!response.ok) {
		const detail = await response.text();
		// Logged, not returned: the client must not learn whether delivery
		// succeeded, since that reveals whether the address exists.
		console.error(`[mail] Resend rejected the send: ${response.status} ${detail}`);
		throw new Error("Failed to send email.");
	}
}

export async function sendOtpEmail(
	to: string,
	code: string,
	ttlMinutes: number,
): Promise<void> {
	// Dev convenience: surface the code in the log so it is easy to find while
	// the mailer is unconfigured. Matches the Laravel `app()->isLocal()` branch.
	if (process.env.NODE_ENV !== "production") {
		console.info(`[otp] code for ${to}: ${code}`);
	}

	await send(
		to,
		"Your Saji verification code",
		`<div style="font-family:system-ui,sans-serif;max-width:480px">
			<h2 style="margin:0 0 16px">Verify your email</h2>
			<p style="margin:0 0 24px;color:#444">
				Enter this code to finish creating your Saji account.
			</p>
			<p style="font-size:32px;letter-spacing:8px;font-weight:700;margin:0 0 24px">
				${code}
			</p>
			<p style="margin:0;color:#666;font-size:14px">
				This code expires in ${ttlMinutes} minutes. If you didn't request it,
				you can ignore this email.
			</p>
		</div>`,
	);
}
