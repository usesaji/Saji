import { create } from "zustand";

export type ContributionFrequency = "daily" | "weekly" | "biweekly" | "monthly";

export type PayoutOrder = "random" | "manual" | "vote" | "custom";

export type Privacy = "public" | "private";

export interface CreateGroupState {
	currentStep: number;
	groupCreated: boolean;

	group_photo: File | undefined | null;
	group_name: string;
	target_amount: string;
	service_charge: string;
	contribution_frequency: ContributionFrequency;

	grace_period: string;
	late_fee_percentage: string;
	payout_order: PayoutOrder;
	auto_approval: boolean;
	contribute_privacy: Privacy;

	setCurrentStep: (step: number) => void;
	nextStep: () => void;
	previousStep: () => void;
	setGroupCreated: (value: boolean) => void;

	updateData: (
		values: Partial<
			Omit<
				CreateGroupState,
				| "currentStep"
				| "setCurrentStep"
				| "nextStep"
				| "previousStep"
				| "updateData"
				| "reset"
			>
		>,
	) => void;

	reset: () => void;
}

export const useCreateGroupStore = create<CreateGroupState>((set) => ({
	currentStep: 1,
	groupCreated: false,

	group_photo: undefined,
	group_name: "",
	target_amount: "",
	service_charge: "",
	contribution_frequency: "daily",

	grace_period: "",
	late_fee_percentage: "",
	payout_order: "manual",
	auto_approval: false,
	contribute_privacy: "public",

	setCurrentStep: (step) => set({ currentStep: step }),

	nextStep: () =>
		set((state) => ({
			currentStep: state.currentStep + 1,
		})),

	previousStep: () =>
		set((state) => ({
			currentStep: state.currentStep - 1,
		})),

	setGroupCreated: (value) => set({ groupCreated: value }),

	updateData: (values) =>
		set((state) => ({
			...state,
			...values,
		})),

	reset: () =>
		set({
			currentStep: 1,
			groupCreated: false,
			group_photo: undefined,
			group_name: "",
			target_amount: "",
			service_charge: "",
			contribution_frequency: "daily",
			grace_period: "",
			late_fee_percentage: "",
			payout_order: "manual",
			auto_approval: false,
			contribute_privacy: "public",
		}),
}));
