"use client";

import { useCallback } from "react";
import { currentAddress } from "../wallet";
import {
	savingsClient,
	PayoutOrder,
	LatePenalty,
} from "../contract/client";

/** 7-dp decimal string / number → i128 stroops (bigint). */
function toStroops(amount: string | number): bigint {
	return BigInt(Math.round(Number(amount) * 10_000_000));
}

const PAYOUT_ORDER: Record<string, PayoutOrder> = {
	manual: PayoutOrder.Manual,
	random: PayoutOrder.Random,
	vote: PayoutOrder.Vote,
	custom: PayoutOrder.Custom,
};
const LATE_PENALTY: Record<string, LatePenalty> = {
	deduct_from_balance: LatePenalty.DeductFromBalance,
	remove_member: LatePenalty.RemoveMember,
};

/**
 * Direct on-chain actions against the Saji savings contract, signed by the
 * connected wallet — no backend round-trip. Each method assembles the call,
 * prompts the wallet to sign, submits to the RPC, and returns the result.
 */
export function useSavingsContract() {
	/** Resolve the connected wallet address or throw a clear error. */
	const requireAddress = useCallback(async (): Promise<string> => {
		const addr = await currentAddress();
		if (!addr) throw new Error("Connect your wallet first.");
		return addr;
	}, []);

	/** Create a group on-chain. Returns the new on-chain group id (bigint). */
	const createGroup = useCallback(
		async (input: {
			token: string;
			contributionAmount: string | number;
			cycleLengthDays: number;
			feeBps?: number;
			lateFeeBps?: number;
			gracePeriodHours?: number;
			payoutOrder: string;
			latePenalty: string;
		}): Promise<bigint> => {
			const organizer = await requireAddress();
			const client = savingsClient(organizer);

			const tx = await client.create_group({
				organizer,
				token: input.token,
				amount: toStroops(input.contributionAmount),
				cycle_length: BigInt(input.cycleLengthDays * 86_400),
				fee_bps: input.feeBps ?? 0,
				late_fee_bps: input.lateFeeBps ?? 0,
				grace_period: BigInt((input.gracePeriodHours ?? 0) * 3_600),
				payout_order: PAYOUT_ORDER[input.payoutOrder] ?? PayoutOrder.Manual,
				late_penalty:
					LATE_PENALTY[input.latePenalty] ?? LatePenalty.DeductFromBalance,
			});

			const sent = await tx.signAndSend();
			const result = sent.result; // Result<u64>
			if (result && "unwrap" in result) return result.unwrap();
			return result as unknown as bigint;
		},
		[requireAddress],
	);

	/** Contribute this cycle to an on-chain group. */
	const contribute = useCallback(
		async (onchainGroupId: bigint | number): Promise<void> => {
			const member = await requireAddress();
			const client = savingsClient(member);

			const tx = await client.contribute({
				group_id: BigInt(onchainGroupId),
				member,
			});
			const sent = await tx.signAndSend();
			const result = sent.result;
			if (result && "unwrap" in result) result.unwrap(); // throws on Err
		},
		[requireAddress],
	);

	/**
	 * Admit a member to an on-chain group. NOTE: the contract requires the
	 * ORGANIZER to authorize this (not the joining member) — so the connected
	 * wallet must be the organizer's. `memberAddress` is the joiner's G-address.
	 */
	const joinGroup = useCallback(
		async (
			onchainGroupId: bigint | number,
			memberAddress: string,
		): Promise<void> => {
			const organizer = await requireAddress();
			const client = savingsClient(organizer);

			const tx = await client.join_group({
				group_id: BigInt(onchainGroupId),
				member: memberAddress,
			});
			const sent = await tx.signAndSend();
			const result = sent.result;
			if (result && "unwrap" in result) result.unwrap();
		},
		[requireAddress],
	);

	/**
	 * Start the group's first cycle (organizer-signed). Flips the group to
	 * Active so members can contribute. Requires ≥ 2 members on-chain.
	 */
	const startCycle = useCallback(
		async (onchainGroupId: bigint | number): Promise<void> => {
			const organizer = await requireAddress();
			const client = savingsClient(organizer);

			const tx = await client.start_cycle({
				group_id: BigInt(onchainGroupId),
			});
			const sent = await tx.signAndSend();
			const result = sent.result;
			if (result && "unwrap" in result) result.unwrap();
		},
		[requireAddress],
	);

	/**
	 * Organizer sets the exact payout rotation order on-chain (Manual groups).
	 * `order` is the members' Stellar addresses in the desired payout sequence —
	 * must be a permutation of the current on-chain members. Organizer-signed.
	 * Client-side so it doesn't route the RPC through the backend (DNS wall).
	 */
	const setPayoutOrder = useCallback(
		async (
			onchainGroupId: bigint | number,
			orderedAddresses: string[],
		): Promise<void> => {
			const organizer = await requireAddress();
			const client = savingsClient(organizer);

			const tx = await client.set_payout_order({
				group_id: BigInt(onchainGroupId),
				order: orderedAddresses,
			});
			const sent = await tx.signAndSend();
			const result = sent.result;
			if (result && "unwrap" in result) result.unwrap(); // throws on Err
		},
		[requireAddress],
	);

	/**
	 * Organizer resolves a member who has missed the current cycle past the
	 * grace period. On-chain rules decide the outcome: an empty/insufficient
	 * wallet (or a `RemoveMember` policy) removes + refunds them; otherwise a
	 * late fee accrues against their eventual payout. Organizer-signed.
	 */
	const resolveDefault = useCallback(
		async (
			onchainGroupId: bigint | number,
			memberAddress: string,
		): Promise<void> => {
			const organizer = await requireAddress();
			const client = savingsClient(organizer);

			const tx = await client.resolve_default({
				group_id: BigInt(onchainGroupId),
				member: memberAddress,
			});
			const sent = await tx.signAndSend();
			const result = sent.result;
			if (result && "unwrap" in result) result.unwrap(); // throws on Err
		},
		[requireAddress],
	);

	/** Has this member been removed (defaulted) from the rotation? Read-only. */
	const isRemoved = useCallback(
		async (
			onchainGroupId: bigint | number,
			memberAddress: string,
		): Promise<boolean> => {
			try {
				const addr = (await currentAddress()) ?? undefined;
				const client = savingsClient(
					addr ?? "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF5",
				);
				const tx = await client.is_removed({
					group_id: BigInt(onchainGroupId),
					member: memberAddress,
				});
				return !!tx.result;
			} catch {
				return false;
			}
		},
		[],
	);

	/** Accrued late-fee debt (stroops) for a member. Read-only. */
	const lateFeeOf = useCallback(
		async (
			onchainGroupId: bigint | number,
			memberAddress: string,
		): Promise<bigint> => {
			try {
				const addr = (await currentAddress()) ?? undefined;
				const client = savingsClient(
					addr ?? "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF5",
				);
				const tx = await client.late_fee_of({
					group_id: BigInt(onchainGroupId),
					member: memberAddress,
				});
				return (tx.result as bigint) ?? BigInt(0);
			} catch {
				return BigInt(0);
			}
		},
		[],
	);

	/**
	 * Read the group's live on-chain state — the member addresses and status —
	 * without signing. Used to reflect true chain state in the UI (who's already
	 * admitted, whether the cycle has started) instead of guessing from the DB.
	 *
	 * Status codes: 0=Draft, 1=Open, 2=Active, 3=Completed.
	 */
	const getOnchainState = useCallback(
		async (
			onchainGroupId: bigint | number,
		): Promise<{ members: string[]; status: number } | null> => {
			try {
				// Reads don't need the connected wallet; any address works as source.
				const addr = (await currentAddress()) ?? undefined;
				const client = savingsClient(
					addr ?? "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF5",
				);

				const membersTx = await client.get_members({
					group_id: BigInt(onchainGroupId),
				});
				const members = (membersTx.result ?? []) as string[];

				const groupTx = await client.get_group({
					group_id: BigInt(onchainGroupId),
				});
				const g = groupTx.result;
				const config =
					g && "unwrap" in g ? g.unwrap() : (g as unknown as { status?: number });
				const status =
					typeof config?.status === "number" ? config.status : 0;

				return { members, status };
			} catch {
				return null; // read failed (e.g. RPC hiccup) — caller falls back
			}
		},
		[],
	);

	/**
	 * Claim a completed-cycle payout the contract earmarked for the caller,
	 * sending it to `to`. The member signs; the escrowed net moves from the
	 * contract straight to that address — no hop through the member's own
	 * wallet, so a withdrawal to a saved destination is ONE signature.
	 *
	 * `to` defaults to the member's own address (claim it home). It must hold a
	 * trustline for the group's token or the claim reverts; check before calling.
	 *
	 * Returns the claimed amount (stroops).
	 */
	const claimPayout = useCallback(
		async (onchainGroupId: bigint | number, to?: string): Promise<bigint> => {
			const member = await requireAddress();
			const client = savingsClient(member);

			const tx = await client.claim_payout({
				group_id: BigInt(onchainGroupId),
				member,
				to: to ?? member,
			});
			const sent = await tx.signAndSend();
			const result = sent.result;
			if (result && "unwrap" in result) return result.unwrap();
			return result as unknown as bigint;
		},
		[requireAddress],
	);

	/** Amount (stroops) the member can claim from a group. Read-only. */
	const claimableOf = useCallback(
		async (
			onchainGroupId: bigint | number,
			memberAddress: string,
		): Promise<bigint> => {
			try {
				const addr = (await currentAddress()) ?? undefined;
				const client = savingsClient(
					addr ?? "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF5",
				);
				const tx = await client.claimable_of({
					group_id: BigInt(onchainGroupId),
					member: memberAddress,
				});
				return (tx.result as bigint) ?? BigInt(0);
			} catch {
				return BigInt(0);
			}
		},
		[],
	);

	return {
		createGroup,
		contribute,
		joinGroup,
		startCycle,
		setPayoutOrder,
		resolveDefault,
		claimPayout,
		claimableOf,
		isRemoved,
		lateFeeOf,
		getOnchainState,
	};
}
