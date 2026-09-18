import { assetUrl, type Group } from "@/lib/api";
import type { CircleGroup } from "@/lib/utils/mock-data";

/**
 * Adapt a backend `Group` into the view shape the existing group cards/preview
 * already render (`CircleGroup`). This lets us feed real API data through the
 * current UI without rewriting its markup — one place owns the field mapping.
 *
 * Every figure here is REAL. This used to hardcode `current: 0`, take its
 * denominator from the nullable user-entered `target_amount`, and render a
 * static avatar image — so a card showed "$0 / $0", an empty progress bar, and
 * "+12" beside "2 Members" regardless of the group. The list payload now
 * carries the viewer's progress, the member faces and the due date, so nothing
 * is faked and nothing is left blank that the backend actually knows.
 */

const PLACEHOLDER_THUMB = "/images/about/backed.svg";
const PLACEHOLDER_BANNER = "/images/group-test-img.png";

/**
 * Contribution frequency → cycle length in days, for the contract's
 * `cycle_length`. One definition shared by both on-chain create paths (the
 * create-group form and the group page's "activate on-chain") so a circle can
 * never be written to the contract with a length that contradicts its label.
 *
 * This does NOT drive payouts — a cycle ends when every active member has
 * contributed, not on a timer. It sets when a contribution is DUE, which is
 * what `grace_period` is measured from and therefore what decides whether a
 * member counts as late (`resolve_default`).
 *
 * `custom` has no fixed length; callers pass the group's
 * `cycle_length_seconds`.
 *
 * SECONDS throughout, matching the contract's own unit — the DB column, this
 * helper and `create_group` all speak the same unit now, so there is no
 * conversion left for a units bug to hide in. It is also what makes the
 * sub-daily presets expressible at all.
 */
const FREQUENCY_SECONDS: Record<string, number> = {
	hourly: 3_600,
	six_hourly: 21_600,
	daily: 86_400,
	two_daily: 172_800,
	weekly: 604_800,
	bi_weekly: 1_209_600,
	monthly: 2_592_000,
	quarterly: 7_776_000,
	yearly: 31_536_000,
};

export function cycleSecondsFor(
	frequency: string | null | undefined,
	customSeconds?: string | number | null,
): number {
	if (frequency === "custom") {
		return Number(customSeconds) || FREQUENCY_SECONDS.weekly;
	}
	return FREQUENCY_SECONDS[frequency ?? ""] ?? FREQUENCY_SECONDS.weekly;
}

/** Human label for a cycle length in seconds, e.g. "6 hours", "2 days". */
export function formatCycleLength(seconds: number): string {
	const units: [number, string][] = [
		[31_536_000, "year"],
		[2_592_000, "month"],
		[604_800, "week"],
		[86_400, "day"],
		[3_600, "hour"],
	];
	for (const [size, name] of units) {
		if (seconds % size === 0 && seconds >= size) {
			const n = seconds / size;
			return n === 1 ? `1 ${name}` : `${n} ${name}s`;
		}
	}
	return `${seconds}s`;
}

/** Title-case a backend snake_case enum value, e.g. "bi_weekly" → "Bi Weekly". */
export function labelize(value?: string | null): string {
	if (!value) return "—";
	return value
		.split("_")
		.map((w) => w.charAt(0).toUpperCase() + w.slice(1))
		.join(" ");
}

/**
 * The card's badge, answering the only question a member cares about: DO I OWE
 * MONEY RIGHT NOW?
 *
 * `active` used to map straight to "PAID", which said "paid" about a circle
 * where the viewer had contributed nothing — `active` means the rotation has
 * started, which is exactly when money IS owed. It read as reassurance at
 * precisely the wrong moment.
 */
function toStatusLabel(group: Group): CircleGroup["status"] {
	if (group.status === "completed") return "PAID";
	// Only an ACTIVE circle can owe anything — nothing is due before the
	// rotation starts, so a forming circle is not "overdue", it is pending.
	if (group.status !== "active") return "PENDING";
	if (group.you_paid_this_cycle) return "PAID";

	// Past the due date and still unpaid. `next_payout_at` is when this cycle
	// closes, so a date in the past with no contribution is genuinely late.
	const due = group.next_payout_at ? new Date(group.next_payout_at) : null;
	if (due && !Number.isNaN(due.getTime()) && due.getTime() < Date.now()) {
		return "OVERDUE";
	}
	return "PENDING";
}

/**
 * "Oct 24" for the card's Next Deposit line, or "—" when it isn't scheduled.
 *
 * This is the CYCLE BOUNDARY (`deposits_open_at + cycle_length`), which is both
 * the deadline for the current contribution and the moment the next deposit
 * window opens. It is deliberately not called a payout date: a cycle pays out
 * as soon as everyone has funded it, which can be long before this — so
 * labelling it "Next Payout" promised a date the money would not wait for.
 */
function toDepositDate(value?: string | null): string {
	if (!value) return "—";
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return "—";
	return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function groupToCircle(group: Group): CircleGroup {
	const memberCount = group.members_count ?? group.member_count ?? 0;

	// The VIEWER's paid-so-far over their commitment for the WHOLE rotation
	// (`contribution × total_cycles`).
	//
	// `target_amount` is only a fallback now. It is nullable and user-entered,
	// and being the sole source here is exactly why every card rendered "$0 /
	// $0": `current` was hardcoded to 0 and the denominator came from a field
	// most circles never set.
	//
	// Heads up on what this bar can show: a member is exempt from funding their
	// own payout, so they pay in `total_cycles − 1` times. Against a
	// `× total_cycles` denominator a member who never misses a contribution
	// still tops out at `(n−1)/n` — 75% in a 4-person circle. See `your_aim`.
	const current = Number(group.you_paid_total ?? 0);
	const target = Number(group.your_aim ?? 0) || Number(group.target_amount ?? 0);

	// Uploaded photos are `/storage/...` paths off the API origin; resolve them
	// to full URLs. Fall back to placeholder art when nothing's uploaded.
	const photo = assetUrl(group.photo_url);

	return {
		id: String(group.id),
		title: group.name,
		subtitle: `${labelize(group.contribution_frequency)} Contribution`,
		image: photo || PLACEHOLDER_THUMB,
		bannerImage: photo || PLACEHOLDER_BANNER,
		current,
		target,
		status: toStatusLabel(group),
		nextDepositDate: toDepositDate(group.next_payout_at),
		memberCount,
		// Real faces. The static art this replaced had four strangers and "+12"
		// burnt into the pixels, which is why cards showed "+12" beside "2
		// Members" — the overflow was in the image, not the data.
		memberAvatars: group.member_avatars ?? [],
		// Real settings when the payload carries them (show()/index()), else "—".
		groupType: labelize(group.group_type),
		payoutOrder: labelize(group.payout_order),
		frequency: labelize(group.contribution_frequency),
		latePenaltyLabel: labelize(group.late_penalty),
		joinMessage:
			"Invitation links will be sent once the group is created & finalized.",
	};
}

/**
 * A short "3d 4h" / "12m 5s" countdown from a number of seconds.
 *
 * Two units at most: the point is a glanceable sense of how long, not
 * stopwatch precision. Clamps at zero rather than showing a negative.
 */
export function formatCountdown(seconds: number): string {
	const total = Math.max(0, Math.floor(seconds));

	const d = Math.floor(total / 86_400);
	const h = Math.floor((total % 86_400) / 3_600);
	const m = Math.floor((total % 3_600) / 60);
	const sec = total % 60;

	if (d > 0) return h > 0 ? `${d}d ${h}h` : `${d}d`;
	if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
	if (m > 0) return `${m}m ${sec}s`;
	return `${sec}s`;
}
