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

		ACTIVITY: "/activity",
		WALLET: "/wallet",
		WALLET_ADD_MONEY: "/wallet/add-money",
		WALLET_WITHDRAW: "/wallet/withdraw",
		ME: "/profile",
	},
};
