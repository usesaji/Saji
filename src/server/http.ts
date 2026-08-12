/**
 * Shared HTTP plumbing for route handlers.
 *
 * Laravel gave us validation errors, 401s, and throttling for free via
 * middleware. Route handlers have no middleware pipeline, so the equivalents
 * live here and each handler wraps itself in `handle()`.
 *
 * Error response shapes match Laravel's exactly — `{ message, errors }` with a
 * 422 for validation — because `src/lib/api/index.ts` already parses that
 * shape. Changing it would mean touching every form in the frontend.
 */

import { ZodError, type ZodType } from "zod";
import { UnauthorizedError } from "./auth";
import { prisma, serialize } from "./db";

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** Any error with an HTTP status the client should see verbatim. */
export class HttpError extends Error {
	constructor(
		readonly status: number,
		message: string,
		readonly errors?: Record<string, string[]>,
	) {
		super(message);
		this.name = "HttpError";
	}
}

export const notFound = (what = "Resource") =>
	new HttpError(404, `${what} not found.`);

export const forbidden = (message = "This action is unauthorized.") =>
	new HttpError(403, message);

/** Laravel's ValidationException equivalent — a 422 with per-field messages. */
export const validationError = (errors: Record<string, string[]>) =>
	new HttpError(422, "The given data was invalid.", errors);

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

export function json(data: unknown, status = 200): Response {
	return Response.json(serialize(data), { status });
}

/**
 * Convert any thrown value into the response shape the frontend expects.
 *
 * Unexpected errors are logged server-side and returned as a bare 500: their
 * messages can carry connection strings, key material, or RPC internals, so
 * they must never reach the client.
 */
export function toErrorResponse(error: unknown): Response {
	if (error instanceof UnauthorizedError) {
		return Response.json({ message: error.message }, { status: 401 });
	}

	if (error instanceof HttpError) {
		return Response.json(
			{ message: error.message, ...(error.errors && { errors: error.errors }) },
			{ status: error.status },
		);
	}

	if (error instanceof ZodError) {
		return Response.json(
			{ message: "The given data was invalid.", errors: zodToErrors(error) },
			{ status: 422 },
		);
	}

	console.error("[api] unhandled error:", error);

	return Response.json(
		{ message: "Server error." },
		{ status: 500 },
	);
}

/** Wrap a handler so every thrown error becomes a well-formed response. */
export function handle(
	fn: () => Promise<Response>,
): Promise<Response> {
	return fn().catch(toErrorResponse);
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function zodToErrors(error: ZodError): Record<string, string[]> {
	const errors: Record<string, string[]> = {};

	for (const issue of error.issues) {
		const key = issue.path.join(".") || "_";
		(errors[key] ??= []).push(issue.message);
	}

	return errors;
}

/**
 * Parse and validate a JSON body.
 *
 * A malformed body is a 422 rather than an unhandled crash, matching how
 * Laravel treated unparseable input.
 */
export async function parseBody<T>(
	request: Request,
	schema: ZodType<T>,
): Promise<T> {
	let raw: unknown;

	try {
		raw = await request.json();
	} catch {
		throw validationError({ _: ["Request body must be valid JSON."] });
	}

	const result = schema.safeParse(raw);
	if (!result.success) throw validationError(zodToErrors(result.error));

	return result.data;
}

/** Validate query-string parameters with the same error shape. */
export function parseQuery<T>(request: Request, schema: ZodType<T>): T {
	const params = Object.fromEntries(new URL(request.url).searchParams);
	const result = schema.safeParse(params);
	if (!result.success) throw validationError(zodToErrors(result.error));
	return result.data;
}

// ---------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------

/**
 * Fixed-window rate limiter backed by Postgres.
 *
 * WHY NOT IN-MEMORY: this used to be a module-level `Map`. Serverless instances
 * do not share memory, so the effective limit was "N per window PER WARM
 * INSTANCE" — under fan-out, effectively no limit at all, on the endpoints
 * guarding login, OTP issuance and OTP verification.
 *
 * The whole check is one atomic statement. A read-then-write would let
 * concurrent requests both observe the same count and both pass; `ON CONFLICT
 * DO UPDATE` with the reset comparison inside SQL means Postgres serialises
 * them on the row lock and the returned count is authoritative.
 *
 * Swapping this for Redis later requires no call-site changes.
 */
export async function rateLimit(
	key: string,
	maxAttempts: number,
	windowSeconds: number,
): Promise<void> {
	const now = new Date();
	const resetAt = new Date(now.getTime() + windowSeconds * 1000);

	// Upsert-and-return in one round trip: start a new window if none exists or
	// the old one has lapsed, otherwise increment within the current window.
	const rows = await prisma.$queryRaw<{ count: number; reset_at: Date }[]>`
		INSERT INTO rate_limits ("key", "count", "reset_at")
		VALUES (${key}, 1, ${resetAt})
		ON CONFLICT ("key") DO UPDATE SET
			"count" = CASE
				WHEN rate_limits."reset_at" < ${now} THEN 1
				ELSE rate_limits."count" + 1
			END,
			"reset_at" = CASE
				WHEN rate_limits."reset_at" < ${now} THEN ${resetAt}
				ELSE rate_limits."reset_at"
			END
		RETURNING "count", "reset_at"
	`;

	const row = rows[0];
	if (!row) return; // Should not happen; never block a request on a limiter bug.

	if (row.count > maxAttempts) {
		const retryAfter = Math.max(
			1,
			Math.ceil((new Date(row.reset_at).getTime() - now.getTime()) / 1000),
		);
		throw new HttpError(429, `Too many attempts. Try again in ${retryAfter}s.`);
	}
}

/** Delete lapsed buckets. Called from the cron sweep so the table stays small. */
export async function pruneRateLimits(): Promise<number> {
	const { count } = await prisma.rateLimit.deleteMany({
		where: { resetAt: { lt: new Date() } },
	});
	return count;
}

export function clientIp(request: Request): string {
	// `X-Forwarded-For` is a LIST that proxies APPEND to, so the leftmost entry
	// is whatever the CLIENT sent — attacker-controlled. Reading `[0]`, as this
	// did, let anyone reset every IP-keyed limit by sending a random header.
	//
	// Order of preference: a platform header the client cannot forge, then the
	// nearest proxy's own value, then the RIGHTMOST XFF entry (appended by the
	// closest trusted hop) — never the leftmost.
	const vercel = request.headers.get("x-vercel-forwarded-for");
	if (vercel) return vercel.trim();

	const real = request.headers.get("x-real-ip");
	if (real) return real.trim();

	const forwarded = request.headers.get("x-forwarded-for");
	if (forwarded) {
		const hops = forwarded.split(",").map((h) => h.trim()).filter(Boolean);
		if (hops.length > 0) return hops[hops.length - 1];
	}

	return "unknown";
}
