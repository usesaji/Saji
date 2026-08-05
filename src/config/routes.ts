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
		CIRCLE: (id: string | number) => `/groups/${id}/circle`,
		GROUP_REQUESTS: (id: string | number) => `/groups/${id}/requests`,
		PAYOUT_ORDER: (id: string | number) => `/groups/${id}/payout-order`,
		GROUP_COMPLETE: (id: string | number) => `/groups/${id}/complete`,
		JOIN_GROUP: (token: string) => `/groups/join/${token}`,

		ACTIVITY: "/activity",
		NOTIFICATIONS: "/activity",
		SEARCH: (q: string) => `/search?q=${encodeURIComponent(q)}`,
		WALLET: "/wallet",
		WITHDRAW: "/wallet/withdraw",
		TRANSACTION: (id: string | number) => `/transactions/${id}`,
		ME: "/profile",

		// Profile sub-pages
		PROFILE_EDIT: "/profile/edit",
		PROFILE_SECURITY: "/profile/security",
		WITHDRAW_INFO: "/profile/withdraw-info",
	},
};
