/**
 * Authentication — the replacement for Laravel Sanctum.
 *
 * Bearer tokens, not cookies. This matters: `config/cors.php` had
 * `supports_credentials => false`, and the frontend sends `Authorization:
 * Bearer` (see `src/lib/api/index.ts`). Keeping the same scheme means the
 * frontend needs no changes, and it sidesteps CSRF entirely since no ambient
 * credential is attached by the browser.
 *
 * Only the SHA-256 hash of each token is stored, so a database leak does not
 * hand an attacker a set of live sessions.
 */

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import bcrypt from "bcryptjs";
import type { User } from "@prisma/client";
import { prisma } from "./db";

/** Token lifetime. Mirrors Sanctum's `expiration` of 30 days. */
const TOKEN_TTL_DAYS = 30;

// ---------------------------------------------------------------------------
// Passwords
// ---------------------------------------------------------------------------

/**
 * bcrypt with cost 12, matching Laravel's default `BCRYPT_ROUNDS`.
 *
 * Existing Laravel hashes are `$2y$` and bcryptjs emits `$2a$`; the two are the
 * same algorithm and bcryptjs verifies `$2y$` correctly, so users migrated from
 * the Laravel database can still log in with their existing passwords.
 */
export function hashPassword(plain: string): Promise<string> {
	return bcrypt.hash(plain, 12);
}

export function verifyPassword(
	plain: string,
	hash: string,
): Promise<boolean> {
	return bcrypt.compare(plain, hash);
}

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------

function hashToken(plain: string): string {
	return createHash("sha256").update(plain).digest("hex");
}

/**
 * Issue a bearer token for a user. The plaintext is returned ONCE — only its
 * hash is persisted, so it cannot be recovered later.
 */
export async function createToken(
	userId: bigint,
	name = "api",
): Promise<string> {
	const plain = randomBytes(32).toString("hex");

	const expiresAt = new Date();
	expiresAt.setDate(expiresAt.getDate() + TOKEN_TTL_DAYS);

	await prisma.accessToken.create({
		data: { userId, name, tokenHash: hashToken(plain), expiresAt },
	});

	return plain;
}

/** Revoke one token by its plaintext value. Used by logout. */
export async function revokeToken(plain: string): Promise<void> {
	await prisma.accessToken.deleteMany({
		where: { tokenHash: hashToken(plain) },
	});
}

/** Revoke every token for a user, e.g. after a password change. */
export async function revokeAllTokens(userId: bigint): Promise<void> {
	await prisma.accessToken.deleteMany({ where: { userId } });
}

// ---------------------------------------------------------------------------
// Request authentication
// ---------------------------------------------------------------------------

export function bearerFromRequest(request: Request): string | null {
	const header = request.headers.get("authorization");
	if (!header?.startsWith("Bearer ")) return null;

	const token = header.slice(7).trim();
	return token || null;
}

/**
 * Resolve the authenticated user, or null.
 *
 * Expired tokens are deleted on encounter, which keeps the table from growing
 * without needing a separate cleanup job.
 */
export async function userFromRequest(
	request: Request,
): Promise<User | null> {
	const plain = bearerFromRequest(request);
	if (!plain) return null;

	const record = await prisma.accessToken.findUnique({
		where: { tokenHash: hashToken(plain) },
		include: { user: true },
	});

	if (!record) return null;

	if (record.expiresAt && record.expiresAt < new Date()) {
		await prisma.accessToken.delete({ where: { id: record.id } });
		return null;
	}

	// Best-effort; a failed touch must never block an authenticated request.
	void prisma.accessToken
		.update({ where: { id: record.id }, data: { lastUsedAt: new Date() } })
		.catch(() => {});

	return record.user;
}

/** Thrown when a route requires authentication and none was supplied. */
export class UnauthorizedError extends Error {
	constructor(message = "Unauthenticated.") {
		super(message);
		this.name = "UnauthorizedError";
	}
}

/** Resolve the user or throw. Use in handlers that require a session. */
export async function requireUser(request: Request): Promise<User> {
	const user = await userFromRequest(request);
	if (!user) throw new UnauthorizedError();
	return user;
}

// ---------------------------------------------------------------------------
// OTP helpers
// ---------------------------------------------------------------------------

/** 4 digits, matching the frontend's 4-slot input. Uses a CSPRNG. */
export function generateOtp(): string {
	return String(randomBytes(2).readUInt16BE(0) % 10000).padStart(4, "0");
}

export function hashOtp(code: string): Promise<string> {
	return bcrypt.hash(code, 10);
}

export function verifyOtp(code: string, hash: string): Promise<boolean> {
	// An empty hash means the code was already consumed — reject without
	// letting bcrypt decide, since bcrypt.compare against "" throws.
	if (!hash) return Promise.resolve(false);
	return bcrypt.compare(code, hash);
}

/** SHA-256 of the single-use signup token issued after OTP verification. */
export function hashSignupToken(plain: string): string {
	return createHash("sha256").update(plain).digest("hex");
}

export function generateSignupToken(): string {
	return randomBytes(32).toString("hex");
}

/** Unguessable invite token. 40 chars, matching the Laravel column width. */
export function generateInviteToken(): string {
	return randomBytes(20).toString("hex");
}

/**
 * Constant-time string comparison, for secrets compared outside bcrypt —
 * currently the cron shared secret.
 */
export function safeEqual(a: string, b: string): boolean {
	const bufA = Buffer.from(a);
	const bufB = Buffer.from(b);
	if (bufA.length !== bufB.length) return false;
	return timingSafeEqual(bufA, bufB);
}
