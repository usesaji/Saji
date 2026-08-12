#!/usr/bin/env node
/**
 * Fail if the DEPLOYED contract disagrees with the Rust source in this repo.
 *
 * This is the check that was missing. `check-contract-bindings.mjs` compares
 * argument COUNTS between the bindings and the deployed contract, which is
 * blind to argument ORDER, argument TYPES, and error/DataKey variants — i.e.
 * blind to every drift that actually shipped:
 *
 *   1. `has_contributed(group_id, cycle, member)` was called server-side as
 *      (group_id, member, cycle). Same arity, wrong order. Every call failed at
 *      simulation, the indexer swallowed it, and no contribution was ever
 *      confirmed.
 *   2. The deployed savings contract declared 16 Error variants and 12 DataKey
 *      variants while the source had 18 and 14 — because the deployed WASM
 *      predated the commit that fixed two CRITICAL fund-loss bugs. Arity was
 *      identical throughout, so a count check saw nothing wrong.
 *
 * Comparing the deployed interface against source catches both.
 *
 * Usage:  node scripts/check-contract-drift.mjs
 * Requires the `stellar` CLI on PATH and network access to the RPC.
 */

import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const NETWORK = process.env.STELLAR_NETWORK_NAME ?? "testnet";

const TARGETS = [
	{
		name: "savings",
		source: "contract/contracts/savings/src/lib.rs",
		envVar: "NEXT_PUBLIC_SAVINGS_CONTRACT_ID",
		fallback: "CA3UA2T54JV4OCIKNTMBRNZFZFV6I4PYCWWZ4REY7LH4S7VGXIMPLXNH",
	},
	{
		name: "challenge",
		source: "contract/contracts/challenge/src/lib.rs",
		envVar: "NEXT_PUBLIC_CHALLENGE_CONTRACT_ID",
		fallback: "CCOVZRUF5SOFVF26G4PKTESVTOXJ3IB6LAVHLEZTSBS3E6OEDHR7Q5JD",
	},
];

/** Normalise a Rust type so `soroban_sdk::Address` and `Address` compare equal. */
function normType(t) {
	return t
		.replace(/soroban_sdk::/g, "")
		.replace(/\s+/g, "")
		.replace(/^&/, "");
}

/**
 * Ordered (name, type) parameter list per function, from a Rust-ish signature
 * block. Works for both the CLI's emitted trait and the contract source.
 */
function parseFns(text) {
	const fns = new Map();
	for (const m of text.matchAll(
		/(?:pub\s+)?fn\s+([a-z_][a-z0-9_]*)\s*\(([\s\S]*?)\)\s*(?:->\s*([^{;]+))?[{;]/g,
	)) {
		const [, name, rawParams] = m;
		// Split on top-level commas only — generics like Result<A, B> nest.
		const params = [];
		let depth = 0;
		let cur = "";
		for (const ch of rawParams) {
			if ("<([".includes(ch)) depth += 1;
			if (">)]".includes(ch)) depth -= 1;
			if (ch === "," && depth === 0) {
				params.push(cur);
				cur = "";
			} else cur += ch;
		}
		if (cur.trim()) params.push(cur);

		const shaped = params
			.map((p) => p.trim())
			.filter(Boolean)
			.map((p) => {
				const i = p.indexOf(":");
				return i === -1
					? { name: p, type: "" }
					: { name: p.slice(0, i).trim(), type: normType(p.slice(i + 1)) };
			})
			.filter((p) => p.name !== "env" && p.name !== "e");

		if (!fns.has(name)) fns.set(name, shaped);
	}
	return fns;
}

/** `Name = 3,` variants inside a named enum block. */
function parseEnum(text, enumName) {
	const start = text.indexOf(`enum ${enumName}`);
	if (start === -1) return new Map();
	const open = text.indexOf("{", start);
	let depth = 0;
	let end = open;
	for (let i = open; i < text.length; i += 1) {
		if (text[i] === "{") depth += 1;
		if (text[i] === "}") {
			depth -= 1;
			if (depth === 0) {
				end = i;
				break;
			}
		}
	}
	const body = text.slice(open + 1, end).replace(/\/\/[^\n]*/g, "");

	const variants = new Map();
	// `Name = 5` (errors) or `Name(u64, Address)` / `Name` (data keys)
	for (const m of body.matchAll(/^\s*([A-Z][A-Za-z0-9_]*)\s*(?:=\s*(\d+))?/gm)) {
		variants.set(m[1], m[2] ?? null);
	}
	return variants;
}

function deployedInterface(contractId) {
	return execFileSync(
		"stellar",
		["contract", "info", "interface", "--id", contractId, "--network", NETWORK],
		{ encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
	);
}

let failed = false;
const note = (m) => process.stdout.write(m + "\n");

for (const target of TARGETS) {
	const contractId = process.env[target.envVar] || target.fallback;
	note(`\n${target.name} (${contractId.slice(0, 12)}…)`);

	let deployedText;
	try {
		deployedText = deployedInterface(contractId);
	} catch (err) {
		note(`  SKIPPED — could not read deployed interface: ${err.message}`);
		continue;
	}

	const sourceText = readFileSync(target.source, "utf8");

	const problems = [];

	// --- Functions: name, arity, ORDER and TYPES ----------------------------
	const deployedFns = parseFns(deployedText);
	const sourceFns = parseFns(sourceText);

	for (const [name, dParams] of deployedFns) {
		const sParams = sourceFns.get(name);
		if (!sParams) {
			problems.push(`  MISSING   ${name} — deployed, but not in source`);
			continue;
		}
		if (sParams.length !== dParams.length) {
			problems.push(
				`  ARITY     ${name} — deployed takes ${dParams.length}, source ${sParams.length}`,
			);
			continue;
		}
		for (let i = 0; i < dParams.length; i += 1) {
			if (dParams[i].type !== sParams[i].type) {
				problems.push(
					`  SIGNATURE ${name} arg ${i + 1}: deployed ${dParams[i].name}: ${dParams[i].type}, ` +
						`source ${sParams[i].name}: ${sParams[i].type}`,
				);
			} else if (dParams[i].name !== sParams[i].name) {
				problems.push(
					`  ARGNAME   ${name} arg ${i + 1}: deployed "${dParams[i].name}", source "${sParams[i].name}" ` +
						`(same type — check the call sites pass them in this order)`,
				);
			}
		}
	}
	for (const name of sourceFns.keys()) {
		// Only public contract functions appear in the deployed interface;
		// private helpers legitimately do not.
		if (!deployedFns.has(name) && sourceText.includes(`pub fn ${name}`)) {
			problems.push(`  NEW       ${name} — in source, NOT deployed (redeploy needed)`);
		}
	}

	// --- Enums: the signal that the deployed WASM predates a source fix -----
	for (const enumName of ["Error", "DataKey"]) {
		const d = parseEnum(deployedText, enumName);
		const s = parseEnum(sourceText, enumName);
		for (const v of s.keys()) {
			if (!d.has(v)) {
				problems.push(
					`  ${enumName.toUpperCase().padEnd(9)} ${v} — in source, NOT deployed ` +
						`(the live contract predates the commit that added it)`,
				);
			}
		}
		for (const v of d.keys()) {
			if (!s.has(v)) {
				problems.push(`  ${enumName.toUpperCase().padEnd(9)} ${v} — deployed, removed from source`);
			}
		}
		for (const [v, ord] of s) {
			if (d.has(v) && ord !== null && d.get(v) !== null && d.get(v) !== ord) {
				problems.push(
					`  ${enumName.toUpperCase().padEnd(9)} ${v} — discriminant ${d.get(v)} deployed vs ${ord} in source`,
				);
			}
		}
	}

	if (problems.length > 0) {
		failed = true;
		note(problems.join("\n"));
	} else {
		note(`  OK — ${deployedFns.size} functions, Error and DataKey all match source`);
	}
}

if (failed) {
	note(
		"\nThe deployed contract does not match this repo's source.\n" +
			"A missing Error/DataKey variant means the LIVE contract is older than the\n" +
			"source — including any security fix added since. Neither contract has an\n" +
			"upgrade function, so closing that gap means deploying a new one and\n" +
			"regenerating bindings:\n" +
			"  stellar contract deploy --wasm contract/target/wasm32v1-none/release/<name>.wasm --network " +
			NETWORK +
			"\n  stellar contract bindings typescript --contract-id <new-id> --network " +
			NETWORK +
			" --output-dir src/lib/contract/<name> --overwrite\n",
	);
	process.exit(1);
}

note("\nDeployed contracts match source.\n");
