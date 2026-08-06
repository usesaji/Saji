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
import { serialize } from "./db";

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
 * In-memory fixed-window rate limiter, replacing Laravel's `throttle:6,1` on
 * the auth routes.
 *
 * LIMITATION, deliberately accepted for this slice: serverless instances do not
 * share memory, so the effective limit is per-instance rather than global. It
 * still blunts a naive brute-force from one client, but it is NOT a substitute
 * for a shared store. Before this handles real money on mainnet, move it to
 * Upstash Redis (or Vercel KV) so the window is global — the call sites here do
 * not need to change, only this function's body.
 */
const buckets = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(
	key: string,
	maxAttempts: number,
	windowSeconds: number,
): void {
	const now = Date.now();
	const bucket = buckets.get(key);

	if (!bucket || bucket.resetAt < now) {
		buckets.set(key, { count: 1, resetAt: now + windowSeconds * 1000 });
		return;
	}

	bucket.count += 1;

	if (bucket.count > maxAttempts) {
		const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
		throw new HttpError(429, `Too many attempts. Try again in ${retryAfter}s.`);
	}

	// Opportunistic cleanup so the map cannot grow without bound on a
	// long-lived instance.
	if (buckets.size > 10_000) {
		for (const [k, v] of buckets) {
			if (v.resetAt < now) buckets.delete(k);
		}
	}
}

/**
 * Client IP for rate-limit keying.
 *
 * `x-forwarded-for` is client-controlled in general, but on Vercel the proxy
 * overwrites it, so the leftmost entry is trustworthy there. Self-hosting this
 * behind a different proxy means re-checking that assumption.
 */
export function clientIp(request: Request): string {
	const forwarded = request.headers.get("x-forwarded-for");
	if (forwarded) return forwarded.split(",")[0].trim();
	return request.headers.get("x-real-ip") ?? "unknown";
}
