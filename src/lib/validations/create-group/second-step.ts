import { z } from "zod";

const WHOLE_NUMBER_REGEX = /^\d+$/;

export const SecondStepSchema = z.object({
	grace_period: z
		.string()
		.trim()
		.nonempty("Grace period is required")
		.regex(WHOLE_NUMBER_REGEX, "Grace period must be a whole number")
		.refine((value) => Number(value) >= 0, {
			message: "Grace period cannot be negative",
		}),

	late_fee_percentage: z
		.string()
		.trim()
		.nonempty("Late fee percentage is required")
		.regex(WHOLE_NUMBER_REGEX, "Late fee must be a whole number")
		.refine((value) => Number(value) >= 0 && Number(value) <= 100, {
			message: "Late fee must be between 0 and 100",
		}),

	payout_order: z.enum(["random", "manual", "vote", "custom"], {
		message: "Please select a payout order",
	}),

	auto_approval: z.boolean(),

	contribute_privacy: z.enum(["public", "private"], {
		message: "Please select a privacy option",
	}),
});

export type SecondStepInput = z.infer<typeof SecondStepSchema>;
