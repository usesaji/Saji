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
		GROUP: "/group",
		ACTIVITY: "/activity",
		WALLET: "/wallet",
		ME: "/profile",
	},
};
