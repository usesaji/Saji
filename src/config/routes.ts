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
	},
};
