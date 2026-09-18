/**
 * Carries the in-flight signup between the three registration pages.
 *
 * The signup token is proof that the user just verified their email, and the
 * Create Profile step needs it. It lives in sessionStorage (not localStorage)
 * so it dies with the tab rather than lingering on a shared machine, and it is
 * cleared the moment the account is created.
 */

const EMAIL_KEY = "saji_signup_email";
const TOKEN_KEY = "saji_signup_token";

function read(key: string): string | null {
	if (typeof window === "undefined") return null;
	return window.sessionStorage.getItem(key);
}

function write(key: string, value: string): void {
	if (typeof window !== "undefined") window.sessionStorage.setItem(key, value);
}

export const signupSession = {
	getEmail: () => read(EMAIL_KEY),
	setEmail: (email: string) => write(EMAIL_KEY, email),

	getToken: () => read(TOKEN_KEY),
	setToken: (token: string) => write(TOKEN_KEY, token),

	clear(): void {
		if (typeof window === "undefined") return;
		window.sessionStorage.removeItem(EMAIL_KEY);
		window.sessionStorage.removeItem(TOKEN_KEY);
	},
};
