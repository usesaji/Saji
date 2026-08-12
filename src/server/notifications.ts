/**
 * Instant notifications, raised when an action COMPLETES.
 *
 * Event-driven by design. There is no sweep, no queue and no cron behind this:
 * `emit()` is called at the point the action finishes, so the notification is
 * written in the same breath as the thing it describes. A scheduled scan can
 * only ever be as fresh as its interval, and this project's is once a day.
 *
 * Two legs, deliberately independent:
 *
 *   1. THE ROW — the user's in-app history and what Realtime pushes to an open
 *      tab. Always written.
 *   2. THE EMAIL — best-effort and opt-out. It reaches someone who is not in
 *      the app, which is the only reason a member can currently be charged a
 *      late fee without ever having been told.
 *
 * `emit()` NEVER THROWS. It is called from paths that have already moved money
 * or already responded to the user; failing there would turn "we couldn't send
 * an email" into "your contribution failed". Every failure is logged and
 * swallowed.
 */

import { after } from "next/server";
import { Prisma, type NotificationType } from "@prisma/client";
import { prisma } from "./db";
import { sendEmail } from "./mail";

export interface NotifyInput {
	userId: bigint;
	type: NotificationType;
	/**
	 * Deterministic key for the real-world event, e.g. `payout:42`.
	 *
	 * This is the ONLY thing standing between an idempotent indexer and an inbox
	 * full of duplicates. The indexer re-observes the same completed payout on
	 * every reconcile pass, so the key must identify the EVENT, never the
	 * attempt — no timestamps, no random component.
	 */
	dedupeKey: string;
	title: string;
	body: string;
	/** Relative in-app path, e.g. `/groups/12/circle`. */
	href?: string | null;
	meta?: Prisma.InputJsonValue;
}

/**
 * Raise a notification. Safe to call repeatedly for the same event — the second
 * call collides on `dedupeKey` and does nothing.
 */
export async function emit(input: NotifyInput): Promise<void> {
	try {
		// CREATE FIRST, and let the unique index be the guard rather than a
		// preceding `findUnique`. A read-then-write would let two concurrent
		// reconcile passes both miss and both send an email; the constraint
		// cannot be raced.
		await prisma.notification.create({
			data: {
				userId: input.userId,
				type: input.type,
				dedupeKey: input.dedupeKey,
				title: input.title,
				body: input.body,
				href: input.href ?? null,
				...(input.meta !== undefined && { meta: input.meta }),
			},
		});
	} catch (error) {
		// P2002 = this event was already notified. That is the expected steady
		// state on every reconcile after the first, not a failure.
		if (
			error instanceof Prisma.PrismaClientKnownRequestError &&
			error.code === "P2002"
		) {
			return;
		}
		console.warn(`[notify] could not record ${input.dedupeKey}:`, error);
		return;
	}

	await emailIfOptedIn(input);
}

/**
 * Raise notifications AFTER the response has been flushed.
 *
 * Use this from route handlers. The user is not waiting on an email, and an
 * inline send would add Resend's round trip to a request that has already done
 * its real work. Same `after()` primitive the chain reconciler uses.
 */
export function emitAfterResponse(input: NotifyInput | NotifyInput[]): void {
	const batch = Array.isArray(input) ? input : [input];
	if (batch.length === 0) return;

	after(async () => {
		for (const one of batch) {
			await emit(one);
		}
	});
}

/**
 * Send the email leg, if the user still wants email.
 *
 * Failures are logged and swallowed: the notification is already durable in the
 * database, so a bounced send costs visibility, not the record. `emailedAt`
 * stays null in that case, which is what distinguishes "in-app only" from
 * "delivered".
 */
async function emailIfOptedIn(input: NotifyInput): Promise<void> {
	try {
		const user = await prisma.user.findUnique({
			where: { id: input.userId },
			select: { email: true, name: true, notifyByEmail: true },
		});

		if (!user?.email || !user.notifyByEmail) return;

		await sendEmail(user.email, input.title, renderEmail(input, user.name));

		await prisma.notification.update({
			where: { dedupeKey: input.dedupeKey },
			data: { emailedAt: new Date() },
		});
	} catch (error) {
		console.warn(`[notify] email for ${input.dedupeKey} failed:`, error);
	}
}

/** Absolute URL for an in-app path — email clients cannot follow a relative one. */
function absoluteUrl(href: string | null | undefined): string | null {
	if (!href) return null;
	const base = (process.env.FRONTEND_URL ?? "").replace(/\/+$/, "");
	return base ? `${base}${href}` : null;
}

/**
 * Escape interpolated text.
 *
 * Every field below reaches this from user-controlled data — a circle name, a
 * display name — so it must never be dropped into HTML raw.
 */
function escapeHtml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

function renderEmail(input: NotifyInput, name: string): string {
	const url = absoluteUrl(input.href);

	return `<div style="font-family:system-ui,sans-serif;max-width:480px">
		<h2 style="margin:0 0 16px">${escapeHtml(input.title)}</h2>
		<p style="margin:0 0 8px;color:#444">Hi ${escapeHtml(name)},</p>
		<p style="margin:0 0 24px;color:#444">${escapeHtml(input.body)}</p>
		${
			url
				? `<p style="margin:0 0 24px">
			<a href="${escapeHtml(url)}" style="background:#4A21C4;color:#fff;padding:12px 20px;border-radius:999px;text-decoration:none;display:inline-block">
				Open Saji
			</a>
		</p>`
				: ""
		}
		<p style="margin:0;color:#666;font-size:14px">
			You can turn these emails off in Saji under Profile &rsaquo; Security.
		</p>
	</div>`;
}
