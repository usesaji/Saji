/**
 * Thin client for the Saji Laravel backend.
 *
 * Uses token (Sanctum) auth: on register/login the backend returns a bearer
 * token which we persist in localStorage and attach to subsequent requests.
 * This file is the single place the frontend talks to the backend.
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
const TOKEN_KEY = "saji_token";

export type User = {
	id: number;
	name: string;
	tag_name: string | null;
	email: string;
	stellar_address: string | null;
};

export type AuthResponse = {
	user: User;
	token: string;
};

/** A backend error with the (possibly field-keyed) validation messages. */
export class ApiError extends Error {
	status: number;
	errors?: Record<string, string[]>;

	constructor(message: string, status: number, errors?: Record<string, string[]>) {
		super(message);
		this.name = "ApiError";
		this.status = status;
		this.errors = errors;
	}
}

// ---- token storage (browser only) ----

export function getToken(): string | null {
	if (typeof window === "undefined") return null;
	return window.localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
	if (typeof window !== "undefined") window.localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
	if (typeof window !== "undefined") window.localStorage.removeItem(TOKEN_KEY);
}

// ---- core request ----

async function request<T>(
	path: string,
	options: { method?: string; body?: unknown; auth?: boolean } = {},
): Promise<T> {
	const { method = "GET", body, auth = false } = options;

	const headers: Record<string, string> = {
		Accept: "application/json",
	};
	if (body !== undefined) headers["Content-Type"] = "application/json";
	if (auth) {
		const token = getToken();
		if (token) headers["Authorization"] = `Bearer ${token}`;
	}

	let res: Response;
	try {
		res = await fetch(`${API_URL}${path}`, {
			method,
			headers,
			body: body !== undefined ? JSON.stringify(body) : undefined,
		});
	} catch {
		// Network-level failure (backend down, CORS blocked, offline).
		throw new ApiError(
			"Could not reach the server. Is the backend running?",
			0,
		);
	}

	// 204 No Content etc.
	const text = await res.text();
	const data = text ? JSON.parse(text) : null;

	if (!res.ok) {
		throw new ApiError(
			data?.message ?? `Request failed (${res.status})`,
			res.status,
			data?.errors,
		);
	}

	return data as T;
}

/** Field-level validation errors, flattened to one message per field. */
export function fieldErrors(err: unknown): Record<string, string> {
	if (!(err instanceof ApiError) || !err.errors) return {};
	return Object.fromEntries(
		Object.entries(err.errors).map(([key, messages]) => [key, messages[0]]),
	);
}

// ---- auth endpoints ----

export const auth = {
	/** Step 1 of signup: mail a 4-digit code to the address. */
	startRegistration(input: { email: string }): Promise<{
		message: string;
		expires_in_minutes: number;
	}> {
		return request("/api/auth/register/start", {
			method: "POST",
			body: input,
		});
	},

	/** Step 2: exchange a correct code for a short-lived signup token. */
	verifyOtp(input: { email: string; otp: string }): Promise<{
		message: string;
		signup_token: string;
	}> {
		return request("/api/auth/register/verify-otp", {
			method: "POST",
			body: input,
		});
	},

	/** Step 3: exchange the signup token + profile for a real account. */
	completeProfile(input: {
		signup_token: string;
		name: string;
		tag_name: string;
		password: string;
		password_confirmation: string;
	}): Promise<AuthResponse> {
		return request<AuthResponse>("/api/auth/register/complete-profile", {
			method: "POST",
			body: input,
		});
	},

	register(input: {
		name: string;
		email: string;
		password: string;
		password_confirmation: string;
	}): Promise<AuthResponse> {
		return request<AuthResponse>("/api/auth/register", {
			method: "POST",
			body: input,
		});
	},

	login(input: { email: string; password: string }): Promise<AuthResponse> {
		return request<AuthResponse>("/api/auth/login", {
			method: "POST",
			body: input,
		});
	},

	me(): Promise<User> {
		return request<User>("/api/auth/me", { auth: true });
	},

	logout(): Promise<{ message: string }> {
		return request<{ message: string }>("/api/auth/logout", {
			method: "POST",
			auth: true,
		});
	},
};
