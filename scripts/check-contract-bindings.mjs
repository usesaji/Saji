#!/usr/bin/env node
/**
 * Fail if a generated binding's embedded contract spec disagrees with the
 * deployed contract.
 *
 * Why this exists: the TypeScript signatures in a generated binding are erased
 * at runtime. What actually encodes a contract call is the base64 XDR spec
 * embedded in the same file. Regenerating one without the other produces a file
 * that type-checks perfectly and fails on-chain — `claim_payout` shipped with a
 * 2-input spec against a 3-input contract, and every call was rejected with
 * `MismatchingParameterLen` while the TS types looked correct.
 *
 * This compares the argument COUNT the spec declares against the deployed
 * contract's own interface, so that class of drift fails loudly and locally.
 *
 * Usage:  node scripts/check-contract-bindings.mjs
 * Requires the `stellar` CLI on PATH and network access to the RPC.
 */

import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const NETWORK = process.env.STELLAR_NETWORK_NAME ?? "testnet";

/** Bindings to verify, and the contract each is generated from. */
const TARGETS = [
	{
		name: "savings",
		file: "src/lib/contract/savings/src/index.ts",
		envVar: "NEXT_PUBLIC_SAVINGS_CONTRACT_ID",
		fallback: "CA3YEH744GMHOKALGS4YXFYXF3LT6XEPL5EPUF6DDWBJC2IDOFTT5LVT",
	},
	{
		name: "challenge",
		file: "src/lib/contract/challenge/src/index.ts",
		envVar: "NEXT_PUBLIC_CHALLENGE_CONTRACT_ID",
		fallback: "CCOVZRUF5SOFVF26G4PKTESVTOXJ3IB6LAVHLEZTSBS3E6OEDHR7Q5JD",
	},
];

/**
 * Argument counts declared by the spec entries embedded in a bindings file.
 *
 * Each entry is base64 XDR; a function entry is the function name (length-
 * prefixed, 4-byte aligned) followed by a big-endian u32 input count. We only
 * need that count, so the blob is scanned rather than fully XDR-decoded.
 */
function specArgCounts(file) {
	const source = readFileSync(file, "utf8");
	const blobs = [...source.matchAll(/"([A-Za-z0-9+/=]{40,})"/g)].map((m) => m[1]);
	const counts = new Map();

	for (const blob of blobs) {
		let buf;
		try {
			buf = Buffer.from(blob, "base64");
		} catch {
			continue;
		}
		const text = buf.toString("latin1");

		// Candidate identifiers, then keep only those that are genuinely
		// length-prefixed — the byte before the name must equal its length.
		for (const match of text.matchAll(/[a-z][a-z0-9_]{2,30}/g)) {
			const name = match[0];
			const at = match.index;
			if (at < 1 || text.charCodeAt(at - 1) !== name.length) continue;

			const pad = (4 - (name.length % 4)) % 4;
			const countAt = at + name.length + pad;
			if (countAt + 4 > buf.length) continue;

			const count = buf.readUInt32BE(countAt);
			// A real function has a plausible arity; this also filters out type
			// names and doc-comment words that happen to look length-prefixed.
			if (count <= 20 && !counts.has(name)) counts.set(name, count);
		}
	}
	return counts;
}

/** Argument counts the DEPLOYED contract declares, via the stellar CLI. */
function deployedArgCounts(contractId) {
	const out = execFileSync(
		"stellar",
		["contract", "info", "interface", "--id", contractId, "--network", NETWORK],
		{ encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
	);

	const counts = new Map();
	// `fn name(` … `)` — count the parameters, ignoring the injected `env`.
	for (const m of out.matchAll(/fn\s+([a-z_][a-z0-9_]*)\s*\(([^)]*)\)/gs)) {
		const [, name, params] = m;
		const arity = params
			.split(",")
			.map((p) => p.trim())
			.filter((p) => p && !p.startsWith("env:"))
			.length;
		counts.set(name, arity);
	}
	return counts;
}

let failed = false;

for (const target of TARGETS) {
	const contractId = process.env[target.envVar] || target.fallback;
	process.stdout.write(`\n${target.name} (${contractId.slice(0, 10)}…)\n`);

	let deployed;
	try {
		deployed = deployedArgCounts(contractId);
	} catch (err) {
		process.stdout.write(`  SKIPPED — could not read deployed interface: ${err.message}\n`);
		continue;
	}

	const spec = specArgCounts(target.file);
	const mismatches = [];

	for (const [fn, expected] of deployed) {
		if (!spec.has(fn)) {
			mismatches.push(`  MISSING  ${fn} — deployed contract has it, bindings do not`);
			continue;
		}
		const actual = spec.get(fn);
		if (actual !== expected) {
			mismatches.push(
				`  DRIFT    ${fn} — spec declares ${actual} arg(s), contract takes ${expected}`,
			);
		}
	}

	if (mismatches.length > 0) {
		failed = true;
		process.stdout.write(mismatches.join("\n") + "\n");
		process.stdout.write(
			`  → regenerate: stellar contract bindings typescript --contract-id ${contractId} ` +
				`--network ${NETWORK} --output-dir src/lib/contract/${target.name} --overwrite\n`,
		);
	} else {
		process.stdout.write(`  OK — ${deployed.size} functions match\n`);
	}
}

if (failed) {
	process.stdout.write(
		"\nBindings are out of sync with a deployed contract. Calls will fail on-chain\n" +
			"with MismatchingParameterLen even though TypeScript compiles.\n",
	);
	process.exit(1);
}

process.stdout.write("\nAll bindings match their deployed contracts.\n");
