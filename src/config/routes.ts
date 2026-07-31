export const pageRoutes = {
	landingPage: "/",

	authRoutes: {
		LOGIN: "/auth/login",
		REGISTER: "/auth/register",
		CREATE_PROFILE: "/auth/register/create-profile",
		OTP: (email: string) => `/auth/register/verify-otp?email=${email}`,
	},

	dashboardRoutes: {
		OVERVIEW: "/overview",
		GROUPS: "/groups",
		NEW_GROUP: "/groups/create",
		GROUP: (id: string) => `/groups/${id}`,
		GROUP_CONTRIBUTE: (id: string) => `/groups/${id}/contribute`,
		GROUP_INVITE: (id: string) => `/groups/${id}/invite`,
		GROUP_ROTATION: (id: string) => `/groups/${id}/rotation`,

		ACTIVITY: "/activity",
		WALLET: "/wallet",
		WALLET_ADD_MONEY: "/wallet/add-money",
		WALLET_WITHDRAW: "/wallet/withdraw",

		ME: "/profile",
		PROFILE_PERSONAL_INFO: "/profile/personal-info",
		PROFILE_PASSWORD_SECURITY: "/profile/password-security",
		PROFILE_WITHDRAWAL_INFO: "/profile/withdrawal-info",
		PROFILE_WITHDRAWAL_BANK_INFO: "/profile/withdrawal-info/bank",
		PROFILE_WITHDRAWAL_WALLET_ADDRESS: "/profile/withdrawal-info/wallet-address",
		PROFILE_WITHDRAWAL_SAVED_ACCOUNTS: "/profile/withdrawal-info/saved-accounts",
		PROFILE_HELP_SUPPORT: "/profile/help-support",
		PROFILE_STATEMENT: "/profile/statement",
	},
};
