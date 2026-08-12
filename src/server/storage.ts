/**
 * Object storage for user uploads (avatars, group photos), backed by Cloudflare R2.
 *
 * Why not the filesystem: the previous implementation wrote into
 * `public/storage/` with `fs.writeFile`. That cannot work on the deployment
 * target for three independent reasons — Vercel's Lambda filesystem is
 * read-only outside `/tmp` (EROFS), `public/storage/` is gitignored so the
 * directory doesn't exist (ENOENT), and Next only serves `public/` as it was at
 * BUILD time, so a file written at runtime is never routable even if the write
 * succeeded. Object storage is the only shape that works here.
 *
 * R2 speaks the S3 API, so this is SigV4-signed `fetch` via aws4fetch (~2 KB)
 * rather than the full AWS SDK — we only need PUT and DELETE, and cold-start
 * size matters on serverless.
 *
 * TWO DISTINCT URLS, do not confuse them:
 *   - R2_ENDPOINT (`<account>.r2.cloudflarestorage.com`) is the S3 API. Every
 *     request to it must be signed. This is where we WRITE.
 *   - R2_PUBLIC_URL is a Connected Domain (or the rate-limited r2.dev subdomain)
 *     that serves objects unauthenticated. This is what `<img src>` READS.
 * Pointing the browser at the endpoint yields 401 on every image.
 */

import { randomUUID } from "node:crypto";
import { AwsClient } from "aws4fetch";

/**
 * Read a required server-side value. Mirrors `required()` in
 * `src/lib/stellar-network.ts`: fail loudly at first use rather than letting a
 * half-configured deploy 500 on the first upload with an opaque message.
 */
function required(name: string): string {
	const value = process.env[name];
	if (!value) {
		throw new Error(
			`${name} is not set. Uploads need Cloudflare R2 configured — see .env.example.`,
		);
	}
	return value;
}

/** Object-key prefixes. Also the only values `uploadImage` will accept. */
export const AVATARS_PREFIX = "avatars";
export const GROUP_PHOTOS_PREFIX = "group-photos";

/**
 * Vercel rejects a serverless request body over 4.5 MB at the platform edge —
 * BEFORE any route code runs — so a larger cap here would surface as an opaque
 * 413 instead of our own validation message. Kept just under the limit to leave
 * room for multipart framing overhead.
 */
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

/**
 * Accepted image types → the extension we store them under.
 *
 * The extension is derived from the SNIFFED type, never from the uploaded
 * filename. Taking `file.name.split(".").pop()` (as this code used to) lets a
 * file with an `image/png` content-type be stored as `.html` or `.svg`, which is
 * stored XSS the moment those objects are served from a domain that shares
 * anything with the app.
 */
const TYPE_TO_EXT: Record<string, string> = {
	"image/jpeg": "jpg",
	"image/png": "png",
	"image/webp": "webp",
};

/**
 * Identify an image by its magic bytes.
 *
 * `File.type` is set by the browser from the file extension and is trivially
 * forged — it is a hint, not evidence. Since the extension we persist is
 * derived from this result, it has to come from the bytes themselves.
 *
 * Returns null for anything not in TYPE_TO_EXT.
 */
export function sniffImageType(bytes: Uint8Array): string | null {
	// PNG: 89 50 4E 47 0D 0A 1A 0A
	if (
		bytes.length >= 8 &&
		bytes[0] === 0x89 &&
		bytes[1] === 0x50 &&
		bytes[2] === 0x4e &&
		bytes[3] === 0x47 &&
		bytes[4] === 0x0d &&
		bytes[5] === 0x0a &&
		bytes[6] === 0x1a &&
		bytes[7] === 0x0a
	) {
		return "image/png";
	}

	// JPEG: FF D8 FF
	if (
		bytes.length >= 3 &&
		bytes[0] === 0xff &&
		bytes[1] === 0xd8 &&
		bytes[2] === 0xff
	) {
		return "image/jpeg";
	}

	// WebP: "RIFF" ???? "WEBP" — the 4-byte size field sits between the two.
	if (
		bytes.length >= 12 &&
		bytes[0] === 0x52 &&
		bytes[1] === 0x49 &&
		bytes[2] === 0x46 &&
		bytes[3] === 0x46 &&
		bytes[8] === 0x57 &&
		bytes[9] === 0x45 &&
		bytes[10] === 0x42 &&
		bytes[11] === 0x50
	) {
		return "image/webp";
	}

	return null;
}

let cachedClient: AwsClient | null = null;

function client(): AwsClient {
	if (!cachedClient) {
		cachedClient = new AwsClient({
			accessKeyId: required("R2_ACCESS_KEY_ID"),
			secretAccessKey: required("R2_SECRET_ACCESS_KEY"),
			// R2 ignores the region, but SigV4 signs it — anything other than
			// "auto" produces a SignatureDoesNotMatch that reads like a bad key.
			region: "auto",
			service: "s3",
		});
	}
	return cachedClient;
}

/** `https://<account>.r2.cloudflarestorage.com/<bucket>` — the signed write path. */
function objectUrl(key: string): string {
	const account = required("R2_ACCOUNT_ID");
	const bucket = required("R2_BUCKET");
	return `https://${account}.r2.cloudflarestorage.com/${bucket}/${key}`;
}

/**
 * Store an image and return its object key (NOT a URL).
 *
 * Keys are what we persist. Building the URL at serialization time
 * (`publicFileUrl`) means moving to a different domain later is a config change
 * rather than a data migration over every user and group row.
 *
 * Throws a plain Error on a rejected upload; callers should let `handle()` turn
 * it into a 500, since a failed write must not leave the DB pointing at an
 * object that isn't there.
 */
export async function uploadImage(
	file: File,
	prefix: typeof AVATARS_PREFIX | typeof GROUP_PHOTOS_PREFIX,
): Promise<{ key: string; contentType: string }> {
	const buffer = await file.arrayBuffer();
	const bytes = new Uint8Array(buffer);

	const contentType = sniffImageType(bytes);
	if (!contentType) {
		throw new Error("unsupported image type");
	}

	const key = `${prefix}/${randomUUID()}.${TYPE_TO_EXT[contentType]}`;

	const response = await client().fetch(objectUrl(key), {
		method: "PUT",
		body: bytes,
		headers: {
			// R2's S3 API REQUIRES Content-Length and rejects chunked transfer
			// encoding outright with `411 MissingContentLength`. Node computes the
			// length itself for a buffer body, but the request passes through
			// Next's instrumented `fetch` on the way out, and if anything in that
			// path hands the body on as a stream the computed length is lost and
			// undici falls back to chunked. Setting it explicitly pins it.
			//
			// Safe to set: `content-length` is in aws4fetch's UNSIGNABLE_HEADERS,
			// so it is excluded from SignedHeaders and cannot cause a
			// SignatureDoesNotMatch.
			"Content-Length": String(bytes.byteLength),
			"Content-Type": contentType,
			// Immutable: every key is a fresh UUID, so an object is never
			// rewritten and a stale cache entry can't serve the wrong image.
			"Cache-Control": "public, max-age=31536000, immutable",
		},
	});

	if (!response.ok) {
		throw new Error(
			`R2 upload failed: ${response.status} ${await response.text()}`,
		);
	}

	return { key, contentType };
}

/**
 * Best-effort delete of a previously stored object.
 *
 * Never throws: this runs when REPLACING an avatar, and failing to clean up the
 * old object must not fail the new upload the user actually asked for. A leaked
 * object costs storage; a thrown error costs the user their upload.
 *
 * Legacy `/storage/...` values (filesystem-era rows) are ignored — there is no
 * such object in R2 to delete.
 */
export async function deleteImage(key: string | null): Promise<void> {
	if (!key || key.startsWith("/storage/") || /^https?:\/\//.test(key)) return;

	try {
		await client().fetch(objectUrl(key), { method: "DELETE" });
	} catch {
		// Orphaned object — acceptable, and not worth failing the request over.
	}
}

/**
 * Object key → the URL a browser can load.
 *
 * Passes through values that are already absolute (Google OAuth avatars) or
 * legacy filesystem paths, so rows written before the R2 migration keep
 * rendering whatever they rendered before instead of turning into broken images.
 */
export function publicFileUrl(key: string | null): string | null {
	if (!key) return null;
	if (/^https?:\/\//.test(key) || key.startsWith("/storage/")) return key;

	const base = process.env.NEXT_PUBLIC_R2_PUBLIC_URL;
	if (!base) return null;

	return `${base.replace(/\/+$/, "")}/${key}`;
}
