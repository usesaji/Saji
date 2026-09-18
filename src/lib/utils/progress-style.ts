export type ProgressTier =
	| "low"
	| "below-halfway"
	| "halfway"
	| "almost-full"
	| "full";

export interface ProgressStyle {
	tier: ProgressTier;
	label: string;
	barColor: string; // bg-* class for the progress bar fill
	badgeBg: string; // bg-* class for a small status badge/pill
	badgeText: string; // text-* class to pair with badgeBg
}

/**
 * Maps a completion percentage (0-100) to a semantic tier and its
 * matching theme colors, so progress bars/badges read at a glance.
 *
 * Tiers:
 *  0–24%   low            -> error
 *  25–49%  below-halfway  -> warning (deeper)
 *  50–74%  halfway        -> warning (lighter)
 *  75–99%  almost-full    -> success (lighter)
 *  100%    full           -> success (deeper)
 */
export function getProgressStyle(percent: number): ProgressStyle {
	const clamped = Math.min(100, Math.max(0, percent));

	if (clamped >= 100) {
		return {
			tier: "full",
			label: "Fully Funded",
			barColor: "bg-primary",
			badgeBg: "bg-success-50",
			badgeText: "text-success-700",
		};
	}

	if (clamped >= 75) {
		return {
			tier: "almost-full",
			label: "Almost Full",
			barColor: "bg-primary-hover",
			badgeBg: "bg-success-50",
			badgeText: "text-success-600",
		};
	}

	if (clamped >= 50) {
		return {
			tier: "halfway",
			label: "Halfway There",
			barColor: "bg-warning-500",
			badgeBg: "bg-warning-50",
			badgeText: "text-warning-800",
		};
	}

	if (clamped >= 25) {
		return {
			tier: "below-halfway",
			label: "Below Halfway",
			barColor: "bg-warning-600",
			badgeBg: "bg-warning-100",
			badgeText: "text-warning-900",
		};
	}

	return {
		tier: "low",
		label: "Just Started",
		barColor: "bg-error-400",
		badgeBg: "bg-error-50",
		badgeText: "text-error-500",
	};
}
