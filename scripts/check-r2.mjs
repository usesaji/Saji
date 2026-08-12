/**
 * Verify the Cloudflare R2 upload path end to end.
 *
 * Uploads a tiny object with the same signed-PUT the app uses, reads it back
 * through the PUBLIC url, then deletes it. Run this after filling in the R2
 * block in .env.local — it turns "images are broken" into a specific answer.
 *
 *   node scripts/check-r2.mjs
 *
 * The read-back step is the point. Writing to R2 succeeds with only the four
 * server secrets, so a write-only check passes even when
 * NEXT_PUBLIC_R2_PUBLIC_URL is wrong — which is the single most common
 * misconfiguration here (pointing it at the S3 endpoint, which needs a
 * signature and 401s the browser).
 */

import { config } from "dotenv";
import { AwsClient } from "aws4fetch";

config({ path: ".env.local", quiet: true });

const {
	R2_ACCOUNT_ID,
	R2_BUCKET,
	R2_ACCESS_KEY_ID,
	R2_SECRET_ACCESS_KEY,
	NEXT_PUBLIC_R2_PUBLIC_URL,
} = process.env;

let failed = false;
const ok = (m) => console.log(`  ok    ${m}`);
const bad = (m, hint) => {
	failed = true;
	console.log(`  FAIL  ${m}`);
	if (hint) console.log(`        ${hint}`);
};

console.log("\nCloudflare R2 check\n");

// --- 1. Config present ----------------------------------------------------
console.log("config");
const missing = Object.entries({
	R2_ACCOUNT_ID,
	R2_BUCKET,
	R2_ACCESS_KEY_ID,
	R2_SECRET_ACCESS_KEY,
	NEXT_PUBLIC_R2_PUBLIC_URL,
})
	.filter(([, v]) => !v)
	.map(([k]) => k);

if (missing.length) {
	bad(`not set: ${missing.join(", ")}`, "See the R2 block at the end of .env.local.");
	console.log("");
	process.exit(1);
}
ok("all five variables set");

// The classic mistake: the S3 endpoint is not a public read URL.
if (NEXT_PUBLIC_R2_PUBLIC_URL.includes("r2.cloudflarestorage.com")) {
	bad(
		"NEXT_PUBLIC_R2_PUBLIC_URL points at the S3 API endpoint",
		"That URL requires a SigV4 signature. Use a Connected Domain or the pub-*.r2.dev subdomain.",
	);
	console.log("");
	process.exit(1);
}
ok("public url is not the S3 endpoint");

// --- 2. Signed write ------------------------------------------------------
const client = new AwsClient({
	accessKeyId: R2_ACCESS_KEY_ID,
	secretAccessKey: R2_SECRET_ACCESS_KEY,
	region: "auto",
	service: "s3",
});

const key = `_healthcheck/${Date.now()}.txt`;
const endpoint = `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${R2_BUCKET}/${key}`;
const body = `saji r2 check ${new Date().toISOString()}`;

console.log("\nwrite");
try {
	const res = await client.fetch(endpoint, {
		method: "PUT",
		body,
		headers: { "Content-Type": "text/plain" },
	});
	if (res.ok) {
		ok(`PUT ${key}`);
	} else {
		const text = await res.text();
		bad(
			`PUT returned ${res.status}`,
			res.status === 401 || res.status === 403
				? "Check R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY, and that the token has Object Read & Write on this bucket."
				: text.slice(0, 300),
		);
	}
} catch (error) {
	bad("PUT threw", error.message);
}

// --- 3. Public read -------------------------------------------------------
console.log("\npublic read");
const publicUrl = `${NEXT_PUBLIC_R2_PUBLIC_URL.replace(/\/+$/, "")}/${key}`;
try {
	const res = await fetch(publicUrl);
	if (res.ok && (await res.text()) === body) {
		ok(`GET ${publicUrl}`);
	} else if (res.status === 401 || res.status === 403) {
		bad(
			`GET returned ${res.status}`,
			"The bucket has no public access. R2 → bucket → Settings → Public access: connect a domain or allow the r2.dev subdomain.",
		);
	} else if (res.status === 404) {
		bad(
			"GET returned 404",
			"Object written but not served here — NEXT_PUBLIC_R2_PUBLIC_URL probably points at a different bucket.",
		);
	} else {
		bad(`GET returned ${res.status}`);
	}
} catch (error) {
	bad("GET threw", `${error.message} — is the hostname right?`);
}

// --- 4. Clean up ----------------------------------------------------------
console.log("\ncleanup");
try {
	const res = await client.fetch(endpoint, { method: "DELETE" });
	// R2 returns 204 on delete; 404 is fine too (nothing to remove).
	if (res.ok || res.status === 404) ok("test object removed");
	else bad(`DELETE returned ${res.status}`, "Harmless — but the token may be read-only.");
} catch (error) {
	bad("DELETE threw", error.message);
}

console.log(
	failed
		? "\nR2 is NOT configured correctly. Fix the FAIL lines above.\n"
		: "\nR2 is configured correctly — uploads will work.\n",
);
process.exit(failed ? 1 : 0);
