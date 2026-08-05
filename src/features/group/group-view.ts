import { assetUrl, type Group } from "@/lib/api";
import type { CircleGroup } from "@/lib/utils/mock-data";

/**
 * Adapt a backend `Group` into the view shape the existing group cards/preview
 * already render (`CircleGroup`). This lets us feed real API data through the
 * current UI without rewriting its markup — one place owns the field mapping.
 *
 * Only real fields are mapped. Where the list payload genuinely lacks a value
 * (pooled total, per-member avatars, next payout date) we use an honest empty
 * ("—" / 0 / placeholder art) rather than a fabricated number — the group
 * DETAIL page fills those from the circle endpoint.
 */

const PLACEHOLDER_THUMB = "/images/about/backed.svg";
const PLACEHOLDER_BANNER = "/images/group-test-img.png";
const PLACEHOLDER_AVATARS = "/images/review-user-imgs.png";

/** Title-case a backend snake_case enum value, e.g. "bi_weekly" → "Bi Weekly". */
export function labelize(value?: string | null): string {
	if (!value) return "—";
	return value
		.split("_")
		.map((w) => w.charAt(0).toUpperCase() + w.slice(1))
		.join(" ");
}

/** Map a backend group status to the card's PAID/PENDING/OVERDUE label. */
function toStatusLabel(status: string): CircleGroup["status"] {
	switch (status) {
		case "active":
		case "completed":
			return "PAID";
		case "draft":
		case "open":
			return "PENDING";
		default:
			return "PENDING";
	}
}

export function groupToCircle(group: Group): CircleGroup {
	const target = Number(group.target_amount ?? 0);
	const memberCount = group.members_count ?? group.member_count ?? 0;

	// Uploaded photos are `/storage/...` paths off the API origin; resolve them
	// to full URLs. Fall back to placeholder art when nothing's uploaded.
	const photo = assetUrl(group.photo_url);

	return {
		id: String(group.id),
		title: group.name,
		subtitle: `${labelize(group.contribution_frequency)} Contribution`,
		image: photo || PLACEHOLDER_THUMB,
		bannerImage: photo || PLACEHOLDER_BANNER,
		// Pooled total isn't in the list payload; the detail page shows the real
		// figure from the circle endpoint. Keep 0 here rather than a fake amount.
		current: 0,
		target: target || 0,
		status: toStatusLabel(group.status),
		nextPayoutDate: "—",
		memberCount,
		memberAvatarsImage: PLACEHOLDER_AVATARS,
		// Real settings when the payload carries them (show()/index()), else "—".
		groupType: labelize(group.group_type),
		payoutOrder: labelize(group.payout_order),
		frequency: labelize(group.contribution_frequency),
		latePenaltyLabel: labelize(group.late_penalty),
		joinMessage:
			"Invitation links will be sent once the group is created & finalized.",
	};
}
