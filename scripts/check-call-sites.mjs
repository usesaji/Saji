#!/usr/bin/env node
/**
 * Fail if a hand-built contract call in `src/server/stellar/service.ts`
 * disagrees with the generated bindings' declared parameter list.
 *
 * WHY THIS EXISTS, and why it is not the same check as
 * `check-contract-bindings.mjs`:
 *
 * That script verifies bindings-vs-deployed-contract. It has never covered the
 * server, because the server does not use the bindings — it hand-assembles
 * positional `ScVal` arrays. Those two things drifted, and the check that would
 * have caught it did not exist:
 *
 *   contract:  has_contributed(group_id: u64, cycle: u32, member: Address)
 *   server:    simulate("has_contributed", [u64(groupId), addr(member), u32(cycle)])
 *
 * Soroban resolves arguments POSITIONALLY. Swapping two of them is not a type
 * error in TypeScript — both are `xdr.ScVal` — so it compiles cleanly and then
 * throws on every single call at simulation. In the indexer that throw was
 * caught and skipped, so the symptom was not an error but silence: no
 * contribution was ever confirmed, and the sweep reported success.
 *
 * The Laravel original passed NAMED arguments through the `stellar` CLI, where
 * order could not matter. Nothing about the positional form preserves that
 * property, so it has to be checked.
 *
 * Deliberately STATIC: it reads the generated bindings file rather than
 * querying a deployed contract, so it needs no `stellar` CLI, no network, and
 * no configured contract id — which is what makes it usable as a CI gate.
 * Bindings-vs-chain remains `check-contract-bindings.mjs`'s job.
 *
 * Usage:  node scripts/check-call-sites.mjs
 */

import { readFileSync } from "node:fs";

const SERVICE = "src/server/stellar/service.ts";

const BINDINGS = {
	savings: "src/lib/contract/savings/src/index.ts",
	challenge: "src/lib/contract/challenge/src/index.ts",
};

/**
 * ScVal helper used at the call site → the binding types it may legitimately
 * encode.
 *
 * `addr()` covers `string` because the bindings render a Soroban `Address` as a
 * TS `string`. The numeric contract enums (`PayoutOrder`, `LatePenalty`) are
 * `#[contracttype]` enums with explicit discriminants, which encode as u32.
 */
const ACCEPTS = {
	u64: ["u64"],
	u32: ["u32", "PayoutOrder", "LatePenalty", "Status"],
	i128: ["i128"],
	addr: ["string"],
};

/**
 * Parameter lists declared by the generated bindings.
 *
 * The generated signature line is unambiguous and ordered, e.g.
 *   has_contributed: ({group_id, cycle, member}: {group_id: u64, cycle: u32, member: string}, …
 * so the second brace group is parsed for `name: type` pairs in order.
 */
function bindingParams(file) {
	const source = readFileSync(file, "utf8");
	const params = new Map();

	const line =
		/^\s{2}([a-z_][a-z0-9_]*):\s*\(\{[^}]*\}:\s*\{([^}]*)\}/gm;

	for (const match of source.matchAll(line)) {
		const [, fn, body] = match;
		const types = body
			.split(",")
			.map((part) => part.trim())
			.filter(Boolean)
			.map((part) => {
				const colon = part.indexOf(":");
				return {
					name: part.slice(0, colon).trim(),
					type: part.slice(colon + 1).trim(),
				};
			});
		params.set(fn, types);
	}

	// Zero-argument calls render as `fn: (options?: MethodOptions) => …` and
	// never match the pattern above; record them so a call passing arguments to
	// a nullary function is still reported rather than silently skipped.
	for (const match of source.matchAll(
		/^\s{2}([a-z_][a-z0-9_]*):\s*\(options\?/gm,
	)) {
		if (!params.has(match[1])) params.set(match[1], []);
	}

	return params;
}

/**
 * Contract calls assembled by hand in the service module.
 *
 * Matches `simulate<…>("fn", [ … ])` and `contract.call("fn", …)`, capturing
 * the ScVal helper applied to each positional argument.
 */
function callSites(file) {
	const source = readFileSync(file, "utf8");
	const calls = [];

	const simulate =
		/simulate<[^>]*>\(\s*"([a-z_][a-z0-9_]*)"\s*,\s*\[([^\]]*)\]\s*(?:,\s*([^)]*?))?\)/gs;

	for (const match of source.matchAll(simulate)) {
		const [whole, fn, argBlock, contractArg = ""] = match;
		calls.push({
			fn,
			args: helpersIn(argBlock),
			contract: targetOf(contractArg),
			line: lineOf(source, match.index),
			raw: whole,
		});
	}

	// `contract.call("fn", ...args)` — the submit path (trigger_payout).
	const direct = /contract\.call\(\s*"([a-z_][a-z0-9_]*)"\s*,\s*([^)]*)\)/gs;
	for (const match of source.matchAll(direct)) {
		const [whole, fn, argBlock] = match;
		calls.push({
			fn,
			args: helpersIn(argBlock),
			contract: "savings",
			line: lineOf(source, match.index),
			raw: whole,
		});
	}

	return calls;
}

/** Ordered ScVal helpers applied in an argument block. */
function helpersIn(block) {
	return [...block.matchAll(/\b(u64|u32|i128|addr)\s*\(/g)].map((m) => m[1]);
}

/**
 * Which contract a call targets.
 *
 * Calls passing a token SAC address go to the standard token interface, which
 * has no generated bindings here — those are reported as skipped rather than
 * guessed at.
 */
function targetOf(contractArg) {
	if (/CHALLENGE_CONTRACT_ID/.test(contractArg)) return "challenge";
	if (/token/i.test(contractArg)) return null;
	return "savings";
}

function lineOf(source, index) {
	return source.slice(0, index).split("\n").length;
}

// ---------------------------------------------------------------------------

const bindings = Object.fromEntries(
	Object.entries(BINDINGS).map(([name, file]) => [name, bindingParams(file)]),
);

const problems = [];
let checked = 0;
let skipped = 0;

for (const call of callSites(SERVICE)) {
	if (call.contract === null) {
		skipped += 1;
		continue;
	}

	const declared = bindings[call.contract]?.get(call.fn);

	if (!declared) {
		// Not in the bindings for that contract: either a token-interface call
		// (`balance`, `transfer`) or a genuinely unknown method.
		skipped += 1;
		continue;
	}

	checked += 1;

	if (declared.length !== call.args.length) {
		problems.push(
			`${SERVICE}:${call.line}  ${call.fn} — passes ${call.args.length} argument(s), ` +
				`contract declares ${declared.length} ` +
				`(${declared.map((p) => `${p.name}: ${p.type}`).join(", ")})`,
		);
		continue;
	}

	declared.forEach((param, index) => {
		const helper = call.args[index];
		const accepted = ACCEPTS[helper] ?? [];

		if (!accepted.includes(param.type)) {
			problems.push(
				`${SERVICE}:${call.line}  ${call.fn} — argument ${index + 1} ` +
					`(${param.name}: ${param.type}) is built with ${helper}(), ` +
					`which encodes ${accepted.join("/") || "an unknown type"}. ` +
					`Contract order is (${declared.map((p) => `${p.name}: ${p.type}`).join(", ")}).`,
			);
		}
	});
}

if (problems.length > 0) {
	process.stdout.write(
		`\nContract call sites disagree with the generated bindings:\n\n` +
			problems.map((p) => `  ${p}`).join("\n") +
			`\n\nSoroban resolves arguments positionally, so these compile fine and fail\n` +
			`at simulation on every call. Fix the order/types in ${SERVICE}.\n`,
	);
	process.exit(1);
}

process.stdout.write(
	`\nAll ${checked} hand-built contract call(s) match the bindings` +
		`${skipped ? ` (${skipped} skipped — token interface or no bindings)` : ""}.\n`,
);
