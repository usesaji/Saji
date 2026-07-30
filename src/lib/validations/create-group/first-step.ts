import { z } from "zod";

const MONEY_REGEX = /^\d+(\.\d{1,2})?$/;

export const FirstStepSchema = z.object({
	group_photo: z
		.custom<File | null>((val) => val instanceof File || val === null, {
			message: "Please upload a group photo",
		})
		.refine(
			(file) => !file || file.size <= 5 * 1024 * 1024,
			"Image must be less than 5MB",
		)
		.refine(
			(file) =>
				!file || ["image/jpeg", "image/png", "image/webp"].includes(file.type),
			"Only JPG, PNG and WebP images are allowed",
		),

	group_name: z
		.string()
		.trim()
		.nonempty("Group name is required")
		.min(2, "Group name is too short")
		.max(50, "Group name is too long"),

	target_amount: z
		.string()
		.trim()
		.nonempty("Target amount is required")
		.regex(MONEY_REGEX, "Enter a valid amount (e.g. 500 or 500.50)")
		.refine((value) => Number(value) > 0, {
			message: "Target amount must be greater than 0",
		}),

	service_charge: z
		.string()
		.trim()
		.nonempty("Service charge is required")
		.regex(MONEY_REGEX, "Enter a valid percentage")
		.refine((value) => Number(value) >= 0 && Number(value) <= 100, {
			message: "Service charge must be between 0 and 100",
		}),

	contribution_frequency: z.enum(["daily", "weekly", "biweekly", "monthly"], {
		message: "Please select a contribution frequency",
	}),
});

export type FirstStepInput = {
	group_photo: File | null;
	group_name: string;
	target_amount: string;
	service_charge: string;
	contribution_frequency: "daily" | "weekly" | "biweekly" | "monthly";
};
// import z from "zod";

// // Matches a positive number with up to 2 decimal places, e.g. "500", "500.5", "500.50"
// const MONEY_REGEX = /^\d+(\.\d{1,2})?$/;
// // Matches a whole number (no decimals) — used for percentages and day counts
// const WHOLE_NUMBER_REGEX = /^\d+$/;

// const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

// const ACCEPTED_IMAGE_TYPES = [
// 	"image/jpeg",
// 	"image/jpg",
// 	"image/png",
// 	"image/webp",
// ];

// export const CreateGroupSchema = z.object({
// 	group_photo: z
// 		.instanceof(File)
// 		.optional()
// 		.refine(
// 			(file) => !file || ACCEPTED_IMAGE_TYPES.includes(file.type),
// 			"Only JPG, PNG and WEBP images are allowed",
// 		)
// 		.refine(
// 			(file) => !file || file.size <= MAX_FILE_SIZE,
// 			"Image must be less than 5MB",
// 		),

// 	group_name: z
// 		.string()
// 		.nonempty("Group name is required")
// 		.trim()
// 		.min(2, "Group name is too short")
// 		.max(50, "Group name is too long"),

// 	target_amount: z
// 		.string()
// 		.nonempty("Target amount is required")
// 		.trim()
// 		.regex(MONEY_REGEX, "Enter a valid amount (e.g. 500 or 500.50)")
// 		.refine((v) => Number(v) > 0, "Target amount must be greater than 0"),

// 	service_charge: z
// 		.string()
// 		.nonempty("Service charge is required")
// 		.trim()
// 		.regex(MONEY_REGEX, "Enter a valid percentage (e.g. 2.5)")
// 		.refine(
// 			(v) => Number(v) >= 0 && Number(v) <= 100,
// 			"Service charge must be between 0 and 100",
// 		),

// 	contribution_frequency: z.enum(["daily", "weekly", "biweekly", "monthly"], {
// 		message: "Please select a contribution frequency",
// 	}),

// 	grace_period: z
// 		.string()
// 		.nonempty("Grace period is required")
// 		.trim()
// 		.regex(WHOLE_NUMBER_REGEX, "Grace period must be a whole number of days")
// 		.refine((v) => Number(v) >= 0, "Grace period cannot be negative"),

// 	late_fee_percentage: z
// 		.string()
// 		.nonempty("Late fee percentage is required")
// 		.trim()
// 		.regex(WHOLE_NUMBER_REGEX, "Enter a valid whole-number percentage")
// 		.refine(
// 			(v) => Number(v) >= 0 && Number(v) <= 100,
// 			"Late fee must be between 0 and 100",
// 		),

// 	payout_order: z.enum(["sequential", "randomized"], {
// 		message: "Please select a payout order",
// 	}),

// 	auto_approval: z.enum(["true", "false"], {
// 		message: "Please choose whether auto-approval is enabled",
// 	}),

// 	contribute_privacy: z.enum(["public", "private"], {
// 		message: "Please select a privacy setting",
// 	}),
// });

// export type CreateGroupInput = z.infer<typeof CreateGroupSchema>;
