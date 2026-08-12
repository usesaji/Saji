"use client";

import { useCallback } from "react";
import { currentAddress } from "../wallet";
import { CALL_OPTIONS, challengeClient } from "../contract/client";

/**
 * Direct on-chain actions against the Saji challenge contract, signed by the
 * connected wallet — no backend round-trip.
 *
 * A challenge is a PERSONAL savings vault: each member's balance is their own,
 * and withdrawal is unconditional (any amount, any time, any destination).
 * There is no pool, no rotation, and no lock — the target is motivational and
 * the contract never reads it.
 *
 * All amounts are `bigint` STROOPS end to end (see `lib/stroops`). Never route
 * them through `Number`: an i128 above 2^53 truncates silently, which on a
 * balance means offering to withdraw money that isn't there.
 */
export function useChallengeContract() {
	/** Resolve the connected wallet address or throw a clear error. */
	const requireAddress = useCallback(async (): Promise<string> => {
		const addr = await currentAddress();
		if (!addr) throw new Error("Connect your wallet first.");
		return addr;
	}, []);

	/**
	 * Save `amount` (stroops) toward a challenge. Pulls the token from the
	 * member's wallet into the contract's escrow, credited to their balance.
	 *
	 * `token` is the asset's Stellar Asset Contract address. A challenge is
	 * locked to the token of its FIRST deposit, so passing a different one
	 * reverts with WrongToken (#3) rather than silently mixing assets.
	 *
	 * Returns the submitted transaction hash — the backend's deposit-recording
	 * endpoint needs it to attach an explorer link and log the action, even
	 * though the amount itself is verified against the contract's own
	 * `balance_of`, not against this hash.
	 */
	const deposit = useCallback(
		async (
			challengeId: bigint | number,
			token: string,
			amount: bigint,
		): Promise<string> => {
			const member = await requireAddress();
			const client = challengeClient(member);

			const tx = await client.deposit({
				challenge_id: BigInt(challengeId),
				member,
				token,
				amount,
			}, CALL_OPTIONS);
			const sent = await tx.signAndSend();
			const result = sent.result;
			if (result && "unwrap" in result) result.unwrap(); // throws on Err

			const hash = sent.sendTransactionResponse?.hash;
			if (!hash) throw new Error("The network did not return a transaction hash.");
			return hash;
		},
		[requireAddress],
	);

	/**
	 * Withdraw `amount` (stroops) of the member's own savings to `to`.
	 *
	 * Unconditional by design — reached the target, gave up, or changed their
	 * mind are all the same call. Unlike a circle payout this takes an AMOUNT,
	 * so a partial withdrawal is one signature with no claim-home-and-forward.
	 *
	 * `to` defaults to the member's own address. It must hold a trustline for
	 * the challenge's token or the transfer reverts and the whole withdrawal
	 * rolls back (the savings stay escrowed, so nothing is lost) — check with
	 * `hasTrustline` before calling.
	 *
	 * Returns the member's REMAINING balance in stroops.
	 */
	const withdraw = useCallback(
		async (
			challengeId: bigint | number,
			amount: bigint,
			to?: string,
		): Promise<bigint> => {
			const member = await requireAddress();
			const client = challengeClient(member);

			const tx = await client.withdraw({
				challenge_id: BigInt(challengeId),
				member,
				to: to ?? member,
				amount,
			}, CALL_OPTIONS);
			const sent = await tx.signAndSend();
			const result = sent.result;
			if (result && "unwrap" in result) return result.unwrap();
			return result as unknown as bigint;
		},
		[requireAddress],
	);

	/**
	 * How much this member has saved in a challenge (stroops). Read-only.
	 *
	 * This IS the money rather than a record of it, so it cannot disagree with
	 * reality — which is why challenge progress is read from here and not from
	 * the `challenge_deposits` table.
	 *
	 * Returns 0 on a read failure (e.g. RPC hiccup) so a transient error shows
	 * an empty balance rather than breaking the page. Callers that must
	 * distinguish "nothing saved" from "couldn't read" should not use this.
	 */
	const balanceOf = useCallback(
		async (
			challengeId: bigint | number,
			memberAddress: string,
		): Promise<bigint> => {
			try {
				// Reads don't need the connected wallet; any address works as source.
				const addr = (await currentAddress()) ?? undefined;
				const client = challengeClient(
					addr ?? "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF5",
				);
				const tx = await client.balance_of({
					challenge_id: BigInt(challengeId),
					member: memberAddress,
				});
				return (tx.result as bigint) ?? 0n;
			} catch {
				return 0n;
			}
		},
		[],
	);

	/**
	 * The token (SAC address) a challenge is denominated in, or null before its
	 * first deposit. Read-only.
	 *
	 * Worth checking before a deposit: the challenge is locked to whatever its
	 * first deposit used, so a group whose app-side `asset_code` disagrees with
	 * the chain would otherwise fail with an opaque WrongToken.
	 */
	const tokenOf = useCallback(
		async (challengeId: bigint | number): Promise<string | null> => {
			try {
				const addr = await currentAddress();
				// The token is now keyed per (challenge, MEMBER), not per challenge:
				// a challenge-wide key let anyone pin an unborn challenge to a junk
				// token for one stroop. Without a connected wallet there is no
				// member to ask about, so there is no answer to give.
				if (!addr) return null;

				const client = challengeClient(addr);
				const tx = await client.token_of({
					challenge_id: BigInt(challengeId),
					member: addr,
				});
				return (tx.result as string | undefined) ?? null;
			} catch {
				return null;
			}
		},
		[],
	);

	return { deposit, withdraw, balanceOf, tokenOf };
}
