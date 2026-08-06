/**
 * Thin client for the Saji API — now the Next.js route handlers in
 * `src/app/api`, previously a separate Laravel server.
 *
 * Uses bearer-token auth: on register/login the API returns a token which we
 * persist in localStorage and attach to subsequent requests. The scheme is
 * unchanged from Sanctum, so this file did not need rewriting — see
 * `src/server/auth.ts`. This is the single place the frontend talks to the API.
 *
 * Organized by domain:
 *   auth · profile · wallet · withdrawInfo · fiatDeposit · groups ·
 *   contributions · challenges · transactions · activity · dashboard
 */

// Empty string = same-origin, the default now that the API lives in this app as
// route handlers under `src/app/api`. Set this only when the API is deployed
// separately.
//
// The fallback is deliberately "" and not a localhost URL: an unset var on a
// fresh clone or a deploy where it was never configured would otherwise point
// the browser at a dead host, and every call fails at the fetch layer as
// "Could not reach the server" — which looks like an outage, not a missing
// environment variable.
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "";
const TOKEN_KEY = "saji_token";

// ---- shared types ----

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

/** Laravel's length-aware paginator envelope. */
export type Paginated<T> = {
	current_page: number;
	data: T[];
	first_page_url: string | null;
	from: number | null;
	last_page: number;
	last_page_url: string | null;
	next_page_url: string | null;
	path: string;
	per_page: number;
	prev_page_url: string | null;
	to: number | null;
	total: number;
};

export type GroupRef = { id: number; name: string };

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

type RequestOptions = {
	method?: string;
	/** JSON body — serialized and sent with a JSON content-type. */
	body?: unknown;
	/** FormData body — sent as-is (multipart), no JSON content-type. */
	form?: FormData;
	auth?: boolean;
	/** Appended as a query string. Null/undefined values are dropped. */
	query?: Record<string, string | number | boolean | null | undefined>;
};

function buildQuery(query?: RequestOptions["query"]): string {
	if (!query) return "";
	const params = new URLSearchParams();
	for (const [key, value] of Object.entries(query)) {
		if (value !== null && value !== undefined) params.set(key, String(value));
	}
	const qs = params.toString();
	return qs ? `?${qs}` : "";
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
	const { method = "GET", body, form, auth = false, query } = options;

	const headers: Record<string, string> = { Accept: "application/json" };
	// FormData sets its own multipart boundary — don't set Content-Type for it.
	if (body !== undefined) headers["Content-Type"] = "application/json";
	if (auth) {
		const token = getToken();
		if (token) headers["Authorization"] = `Bearer ${token}`;
	}

	let res: Response;
	try {
		res = await fetch(`${API_URL}${path}${buildQuery(query)}`, {
			method,
			headers,
			body: form ?? (body !== undefined ? JSON.stringify(body) : undefined),
		});
	} catch {
		// Network-level failure (backend down, CORS blocked, offline).
		throw new ApiError("Could not reach the server. Is the backend running?", 0);
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

/**
 * Resolve a stored image path to a loadable URL.
 *
 * The backend stores uploaded images as `/storage/...` paths (served off the
 * API origin), while external images (e.g. Google avatars) are already absolute.
 * Returns `fallback` when there's nothing stored, so callers get a placeholder
 * for users/groups that haven't uploaded a picture yet.
 */
export function assetUrl(
	path: string | null | undefined,
	fallback = "",
): string {
	if (!path) return fallback;
	if (/^https?:\/\//i.test(path)) return path; // already absolute
	return `${API_URL}${path.startsWith("/") ? "" : "/"}${path}`;
}

/** Download a binary response (e.g. statement PDF/CSV) with auth. */
export async function downloadFile(
	path: string,
	query?: RequestOptions["query"],
): Promise<Blob> {
	const headers: Record<string, string> = {};
	const token = getToken();
	if (token) headers["Authorization"] = `Bearer ${token}`;

	const res = await fetch(`${API_URL}${path}${buildQuery(query)}`, { headers });
	if (!res.ok) throw new ApiError(`Download failed (${res.status})`, res.status);
	return res.blob();
}

// ================================================================
// auth
// ================================================================

export const auth = {
	/** Step 1 of signup: mail a 4-digit code to the address. */
	startRegistration(input: { email: string }): Promise<{
		message: string;
		expires_in_minutes: number;
	}> {
		return request("/api/auth/register/start", { method: "POST", body: input });
	},

	/** Step 2: exchange a correct code for a short-lived signup token. */
	verifyOtp(input: { email: string; otp: string }): Promise<{
		message: string;
		signup_token: string;
	}> {
		return request("/api/auth/register/verify-otp", { method: "POST", body: input });
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

	/** Single-shot register (name + email + password), no OTP flow. */
	register(input: {
		name: string;
		email: string;
		password: string;
		password_confirmation: string;
	}): Promise<AuthResponse> {
		return request<AuthResponse>("/api/auth/register", { method: "POST", body: input });
	},

	login(input: { email: string; password: string }): Promise<AuthResponse> {
		return request<AuthResponse>("/api/auth/login", { method: "POST", body: input });
	},

	/** Full-page URL that kicks off the Google server-side OAuth flow. */
	googleRedirectUrl(): string {
		return `${API_URL}/api/auth/google/redirect`;
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

// ================================================================
// profile
// ================================================================

export type ProfileDetails = {
	id: number;
	name: string;
	tag_name: string | null;
	email: string;
	avatar_url: string | null;
	stellar_address: string | null;
	date_of_birth: string | null;
	gender: string | null;
	address: string | null;
	has_password: boolean;
	is_google_linked: boolean;
	security: {
		twofa_on_suspicious_withdrawal: boolean;
		lock_after_failed_attempts: number;
	};
};

export const profile = {
	show(): Promise<ProfileDetails> {
		return request<ProfileDetails>("/api/profile", { auth: true });
	},

	update(input: {
		name?: string;
		tag_name?: string;
		date_of_birth?: string | null;
		gender?: "male" | "female" | "other" | "prefer_not_to_say" | null;
		address?: string | null;
	}): Promise<User> {
		return request<User>("/api/profile", { method: "PATCH", body: input, auth: true });
	},

	uploadAvatar(file: File): Promise<{ avatar_url: string }> {
		const form = new FormData();
		form.append("avatar", file);
		return request("/api/profile/avatar", { method: "POST", form, auth: true });
	},

	changePassword(input: {
		password: string;
		password_confirmation: string;
		current_password?: string;
	}): Promise<{ message: string }> {
		return request("/api/profile/password", { method: "POST", body: input, auth: true });
	},

	updateSecurity(input: {
		twofa_on_suspicious_withdrawal?: boolean;
		lock_after_failed_attempts?: number;
	}): Promise<{
		twofa_on_suspicious_withdrawal: boolean;
		lock_after_failed_attempts: number;
	}> {
		return request("/api/profile/security", {
			method: "PATCH",
			body: input,
			auth: true,
		});
	},

	/** Link/unlink the user's Stellar wallet (public address only). */
	linkWallet(stellar_address: string | null): Promise<{
		stellar_address: string | null;
		linked: boolean;
	}> {
		return request("/api/profile/wallet", {
			method: "PATCH",
			body: { stellar_address },
			auth: true,
		});
	},
};

// ================================================================
// wallet
// ================================================================

export type WalletBalance = {
	linked: boolean;
	stellar_address: string | null;
	amount: string | null;
	asset_code: string;
};

/** A single circle the user has a claimable payout in. */
export type ClaimableEntry = {
	group_id: number;
	onchain_group_id: number;
	group_name: string;
	asset_code: string;
	amount: string;
};

/** One asset's withdrawable balance (wallet + claimable circle payouts). */
export type AssetBalance = {
	asset_code: string;
	wallet_amount: string | null;
	claimable_total: string;
	total: string | null;
	claimables: ClaimableEntry[];
};

/** "Saji balance": withdrawable money broken down per asset (XLM/USDC/USDT). */
export type SajiBalance = {
	linked: boolean;
	assets: AssetBalance[];
};

export const wallet = {
	balance(): Promise<WalletBalance> {
		return request<WalletBalance>("/api/wallet/balance", { auth: true });
	},

	/** Total withdrawable = claimable circle payouts + wallet, + per-circle list. */
	sajiBalance(): Promise<SajiBalance> {
		return request<SajiBalance>("/api/wallet/saji-balance", { auth: true });
	},

	/**
	 * The user's live circles (DB only, no RPC). The frontend reads each
	 * circle's claimable payout directly from chain — the backend's RPC read is
	 * blocked from the serve worker (DNS wall), so this avoids relying on it.
	 */
	myCircles(): Promise<{
		stellar_address: string | null;
		circles: {
			group_id: number;
			onchain_group_id: number;
			group_name: string;
			asset_code: string;
		}[];
	}> {
		return request("/api/wallet/my-circles", { auth: true });
	},

	/**
	 * Per-asset: what Saji has actually paid this user, and how much of it they
	 * have already withdrawn. Used to cap the "in your wallet" figure so the
	 * withdraw screen never offers to send funds Saji didn't pay. Pure DB.
	 */
	payoutSummary(): Promise<{
		assets: {
			asset_code: string;
			paid_total: string;
			withdrawn_total: string;
			/** Paid but not yet withdrawn. */
			owed: string;
		}[];
	}> {
		return request("/api/wallet/payout-summary", { auth: true });
	},

	/** Build an unsigned withdrawal payment for the wallet to sign. */
	withdraw(input: {
		amount: string | number;
		destination?: string;
		asset_code?: string;
	}): Promise<{
		unsigned_xdr: string;
		destination: string;
		asset_code: string;
		amount: string;
	}> {
		return request("/api/wallet/withdraw", { method: "POST", body: input, auth: true });
	},

	/** Broadcast the wallet-signed withdrawal. */
	submitWithdraw(input: { signed_xdr: string }): Promise<Transaction> {
		return request<Transaction>("/api/wallet/withdraw/submit", {
			method: "POST",
			body: input,
			auth: true,
		});
	},

	/**
	 * Log a withdrawal that was built + submitted CLIENT-SIDE (via Horizon),
	 * so it appears in history. The backend records the real on-chain hash.
	 */
	logWithdrawal(input: {
		/** Omitted when the contract call itself settled the transfer (a payout
		 *  claimed straight to the destination has no separate payment hash). */
		tx_hash?: string;
		amount: string | number;
		asset_code: string;
	}): Promise<Transaction> {
		return request<Transaction>("/api/wallet/withdraw/log", {
			method: "POST",
			body: input,
			auth: true,
		});
	},

	history(input?: { per_page?: number; page?: number }): Promise<Paginated<Transaction>> {
		return request("/api/wallet/history", { auth: true, query: input });
	},
};

// ================================================================
// withdraw destinations
// ================================================================

export type WithdrawDestination = {
	id: number;
	user_id: number;
	stellar_address: string;
	memo: string | null;
	memo_type: "text" | "id" | "none";
	destination_label: string | null;
	is_primary: boolean;
};

type WithdrawDestinationInput = {
	stellar_address: string;
	memo?: string | null;
	memo_type?: "text" | "id" | "none";
	destination_label?: string | null;
	is_primary?: boolean;
};

export const withdrawInfo = {
	index(): Promise<WithdrawDestination[]> {
		return request<WithdrawDestination[]>("/api/withdraw-info", { auth: true });
	},

	store(input: WithdrawDestinationInput): Promise<WithdrawDestination> {
		return request("/api/withdraw-info", { method: "POST", body: input, auth: true });
	},

	update(id: number, input: WithdrawDestinationInput): Promise<WithdrawDestination> {
		return request(`/api/withdraw-info/${id}`, {
			method: "PATCH",
			body: input,
			auth: true,
		});
	},

	setPrimary(id: number): Promise<WithdrawDestination> {
		return request(`/api/withdraw-info/${id}/primary`, { method: "POST", auth: true });
	},

	destroy(id: number): Promise<{ message: string }> {
		return request(`/api/withdraw-info/${id}`, { method: "DELETE", auth: true });
	},
};

// ================================================================
// groups (rotating circles)
// ================================================================

export type Group = {
	id: number;
	name: string;
	description: string | null;
	photo_url: string | null;
	organizer_id: number;
	status: string;
	asset_code: string;
	contribution_amount: string;
	target_amount: string | null;
	contribution_frequency: string;
	current_cycle: number;
	// On-chain group id (null until the group is created on the contract).
	onchain_group_id?: number | null;
	// Group rules/settings (present on show()/index() payloads).
	group_type?: string;
	payout_order?: string;
	late_penalty?: string;
	// On-chain create params (present on show()) — needed to (re)create the group
	// on the contract if it wasn't linked at creation time.
	fee_bps?: number;
	late_fee_bps?: number;
	grace_period_hours?: number;
	cycle_length_days?: number;
	members_count?: number;
	member_count?: number;
	// Challenge (public circle) fields — present on /challenges items.
	circle_kind?: string;
	savings_target?: string | null;
	challenge_ends_at?: string | null;
	// Present on show(): members with their linked user (id/name/address).
	members?: {
		id: number;
		user_id: number;
		status: "pending" | "approved";
		user?: { id: number; name: string; stellar_address: string | null } | null;
	}[];
};

export type GroupMember = {
	id: number;
	group_id: number;
	user_id: number;
	status: "pending" | "approved";
	payout_position: number | null;
};

/** Public-safe group preview shown behind an invite link. */
export type GroupJoinPreview = {
	id: number;
	name: string;
	description: string | null;
	photo_url: string | null;
	target_amount: string | null;
	member_count: number;
	settings: {
		group_type: string;
		payout_order: string;
		contribution_amount: string;
		contribution_frequency: string;
		fee_bps: number;
		late_fee_bps: number;
		grace_period_hours: number;
		late_penalty: string;
		auto_approve_join: boolean;
	};
};

/** The Circle/Group page payload (real totals, progress, payout rotation). */
export type GroupCircle = {
	group: {
		id: number;
		name: string;
		status: string;
		asset_code: string;
		contribution_amount: string;
		contribution_frequency: string;
		target_amount: string | null;
		contract_address: string | null;
	};
	member_count: number;
	current_cycle: number;
	total_deposited: string;
	you_paid_this_cycle: boolean;
	user_progress: { paid: string; aim: string; percent: number };
	circle_progress: { cycles_done: number; cycles_total: number; percent: number };
	payout_rotation: {
		position: number;
		user_id: number;
		name: string | null;
		has_received_payout: boolean;
		removed?: boolean;
	}[];
	cycle_activity: {
		id: number;
		type: string;
		status: string;
		stellar_tx_hash: string | null;
		explorer_url: string | null;
		created_at: string;
	}[];
};

/** Result shape for endpoints that return a domain row + an unsigned tx. */
type WithUnsignedXdr<T> = T & { unsigned_xdr: string | null };

export type CreateGroupInput = {
	name: string;
	description?: string | null;
	photo_url?: string | null;
	asset_code?: string;
	contribution_amount: string | number;
	target_amount?: string | number | null;
	contribution_frequency: "daily" | "weekly" | "bi_weekly" | "monthly" | "custom";
	cycle_length_days?: number;
	fee_bps?: number;
	late_fee_bps?: number;
	grace_period_hours?: number;
	late_penalty?: "deduct_from_balance" | "remove_member";
	payout_order?: "random" | "manual" | "vote" | "custom";
	group_type?: "public" | "private";
	auto_approve_join?: boolean;
	hide_balances?: boolean;
};

export const groups = {
	index(): Promise<Group[]> {
		return request<Group[]>("/api/groups", { auth: true });
	},

	store(input: CreateGroupInput): Promise<{ group: Group; unsigned_xdr: string | null }> {
		return request("/api/groups", { method: "POST", body: input, auth: true });
	},

	/**
	 * Record the on-chain group id after creating the group directly via the
	 * contract bindings (client-side signing). Links it to the DB row + marks live.
	 */
	recordOnchain(
		id: number,
		input: { onchain_group_id: number; tx_hash?: string },
	): Promise<{ onchain_group_id: number; status: string }> {
		return request(`/api/groups/${id}/onchain`, {
			method: "PATCH",
			body: input,
			auth: true,
		});
	},

	/** Mark the group active after the cycle is started on-chain (status sync). */
	activate(id: number): Promise<{ status: string; current_cycle: number }> {
		return request(`/api/groups/${id}/activate`, { method: "POST", auth: true });
	},

	show(id: number): Promise<Group> {
		return request<Group>(`/api/groups/${id}`, { auth: true });
	},

	circle(id: number): Promise<GroupCircle> {
		return request<GroupCircle>(`/api/groups/${id}/circle`, { auth: true });
	},

	/** Public-safe preview of a group behind an invite token. */
	joinPreviewTyped(token: string): Promise<GroupJoinPreview> {
		return request<GroupJoinPreview>(`/api/groups/join/${token}`, { auth: true });
	},

	uploadPhoto(id: number, file: File): Promise<{ photo_url: string }> {
		const form = new FormData();
		form.append("photo", file);
		return request(`/api/groups/${id}/photo`, { method: "POST", form, auth: true });
	},

	approve(groupId: number, memberId: number): Promise<WithUnsignedXdr<{ member: GroupMember }>> {
		return request(`/api/groups/${groupId}/members/${memberId}/approve`, {
			method: "POST",
			auth: true,
		});
	},

	/** Organizer declines a pending join request. */
	decline(groupId: number, memberId: number): Promise<{ message: string }> {
		return request(`/api/groups/${groupId}/members/${memberId}`, {
			method: "DELETE",
			auth: true,
		});
	},

	setPayoutOrder(id: number, memberIds: number[]): Promise<WithUnsignedXdr<{ members: GroupMember[] }>> {
		return request(`/api/groups/${id}/payout-order`, {
			method: "POST",
			body: { member_ids: memberIds },
			auth: true,
		});
	},

	inviteLink(id: number): Promise<{ invite_token: string; invite_url: string | null }> {
		return request(`/api/groups/${id}/invite-link`, { auth: true });
	},

	/** Preview a group by its invite token (public-safe fields). */
	joinPreview(token: string): Promise<unknown> {
		return request(`/api/groups/join/${token}`, { auth: true });
	},

	/** Join via invite token. */
	joinByToken(token: string): Promise<GroupMember> {
		return request<GroupMember>(`/api/groups/join/${token}`, {
			method: "POST",
			auth: true,
		});
	},

	/** Broadcast a wallet-signed on-chain tx for this group. */
	submitOnchain(
		id: number,
		input: { signed_xdr: string; type: "create_group" | "join" | "contribution" | "payout" },
	): Promise<Transaction> {
		return request<Transaction>(`/api/groups/${id}/submit`, {
			method: "POST",
			body: input,
			auth: true,
		});
	},

	/** Per-group dashboard (health snapshot). */
	dashboard(id: number): Promise<unknown> {
		return request(`/api/groups/${id}/dashboard`, { auth: true });
	},
};

// ================================================================
// contributions
// ================================================================

export type Contribution = {
	id: number;
	group_id: number;
	user_id: number;
	cycle: number;
	amount: string;
	status: "pending" | "confirmed";
};

export const contributions = {
	index(groupId: number): Promise<Contribution[]> {
		return request<Contribution[]>(`/api/groups/${groupId}/contributions`, { auth: true });
	},

	/** Record the current-cycle contribution; returns the unsigned contribute tx. */
	store(groupId: number): Promise<WithUnsignedXdr<{ contribution: Contribution }>> {
		return request(`/api/groups/${groupId}/contributions`, {
			method: "POST",
			auth: true,
		});
	},

	/** Confirm an on-chain-settled contribution (flips pending → confirmed). */
	confirm(groupId: number, tx_hash?: string): Promise<Contribution> {
		return request<Contribution>(
			`/api/groups/${groupId}/contributions/confirm`,
			{ method: "POST", body: { tx_hash }, auth: true },
		);
	},
};

// ================================================================
// challenges (public savings circles)
// ================================================================

export const challenges = {
	index(input?: { q?: string; per_page?: number }): Promise<Paginated<Group>> {
		return request("/api/challenges", { auth: true, query: input });
	},

	store(input: {
		name: string;
		description?: string | null;
		photo_url?: string | null;
		asset_code?: string;
		savings_target: string | number;
		challenge_ends_at?: string | null;
	}): Promise<Group> {
		return request<Group>("/api/challenges", { method: "POST", body: input, auth: true });
	},

	join(groupId: number): Promise<GroupMember> {
		return request<GroupMember>(`/api/challenges/${groupId}/join`, {
			method: "POST",
			auth: true,
		});
	},

	leave(groupId: number): Promise<{ message: string }> {
		return request(`/api/challenges/${groupId}/leave`, { method: "POST", auth: true });
	},

	summary(groupId: number): Promise<unknown> {
		return request(`/api/challenges/${groupId}/summary`, { auth: true });
	},

	myProgress(groupId: number): Promise<{
		group_id: number;
		saved: string;
		target: string;
		percent: number;
		reached: boolean;
		challenge_ends_at: string | null;
	}> {
		return request(`/api/challenges/${groupId}/progress`, { auth: true });
	},

	/** Record a save toward the target (backed by an on-chain tx hash). */
	deposit(groupId: number, input: { amount: string | number; stellar_tx_hash: string }): Promise<unknown> {
		return request(`/api/challenges/${groupId}/deposit`, {
			method: "POST",
			body: input,
			auth: true,
		});
	},
};

// ================================================================
// transactions
// ================================================================

export type Transaction = {
	id: number;
	user_id: number;
	group_id: number | null;
	type: "create_group" | "join" | "contribution" | "payout" | "other";
	status: "pending" | "success" | "failed";
	stellar_tx_hash: string | null;
	explorer_url: string | null;
	created_at: string;
	group?: GroupRef | null;
};

export const transactions = {
	index(input?: {
		type?: Transaction["type"];
		status?: Transaction["status"];
		q?: string;
		per_page?: number;
	}): Promise<Paginated<Transaction>> {
		return request("/api/transactions", { auth: true, query: input });
	},

	show(id: number): Promise<{
		id: number;
		type: Transaction["type"];
		status: Transaction["status"];
		amount: string | null;
		group: GroupRef | null;
		transaction_no: string | null;
		explorer_url: string | null;
		date_time: string;
	}> {
		return request(`/api/transactions/${id}`, { auth: true });
	},

	/** Download a statement (PDF or CSV) as a Blob. */
	statement(input?: {
		file_type?: "pdf" | "csv";
		start_date?: string;
		end_date?: string;
	}): Promise<Blob> {
		return downloadFile("/api/transactions/statement", input);
	},
};

// ================================================================
// activity feed
// ================================================================

export type ActivityRow = {
	id: number;
	type: Transaction["type"];
	status: Transaction["status"];
	group: GroupRef | null;
	amount: string | null;
	stellar_tx_hash: string | null;
	explorer_url: string | null;
	created_at: string;
};

export const activity = {
	index(input?: {
		filter?: "all" | "contributions" | "payout" | "withdrawal";
		per_page?: number;
		page?: number;
	}): Promise<Paginated<ActivityRow>> {
		return request("/api/activity", { auth: true, query: input });
	},
};

// ================================================================
// user home dashboard
// ================================================================

export type DashboardCircle = {
	id: number;
	name: string;
	status: string;
	asset_code: string;
	contribution_amount: string;
	member_count: number;
	current_cycle: number;
	contributed_this_cycle: boolean;
};

export type QuickDeposit = {
	group_id: number;
	group_name: string;
	amount: string;
	asset_code: string;
	cycle: number;
	due_at: string | null;
	contribute_endpoint: string;
};

/** One asset's worth of money still in play across the user's circles. */
export type SavedAsset = {
	asset_code: string;
	saved: string;
};

export type DashboardData = {
	/**
	 * The LARGEST single asset's saved figure — a real amount in a real
	 * currency, never a cross-currency sum. A circle saves in exactly one token,
	 * so a user in several circles can hold several currencies; use `assets` for
	 * the full picture and treat this only as the headline.
	 */
	saved_balance: string;
	/** The asset `saved_balance` is denominated in. */
	asset_code: string;
	/** Every asset with money in play, largest first. Empty when nothing saved. */
	assets: SavedAsset[];
	/** Distinct OTHER people the user saves with, across all their circles. */
	people_total: number;
	circles: DashboardCircle[];
	circles_total: number;
	has_more_circles: boolean;
	quick_deposit: QuickDeposit | null;
};

export const dashboard = {
	show(): Promise<DashboardData> {
		return request<DashboardData>("/api/dashboard", { auth: true });
	},
};
