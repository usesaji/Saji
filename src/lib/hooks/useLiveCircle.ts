"use client";

import { useCallback, useEffect, useState } from "react";
import { currentAddress } from "../wallet";
import { savingsClient } from "../contract/client";

/** Live on-chain snapshot of a circle — read straight from the RPC (fast). */
export type LiveCircle = {
	/** 0=Draft, 1=Open, 2=Active, 3=Completed. */
	status: number;
	cycle: number;
	/** Pool held for the current cycle, in whole tokens. */
	pool: number;
	members: string[];
	/** The connected member's claimable payout, in whole tokens. */
	myClaimable: number;
	/** Has the connected member paid the CURRENT cycle? */
	paidThisCycle: boolean;
	/**
	 * Late-fee debt the connected member owes, in STROOPS.
	 *
	 * The contract charges `amount + this` on their next contribution, so the UI
	 * must add it to whatever it tells the user they are about to pay. Kept as a
	 * bigint rather than routed through Number: these are i128 values, and the
	 * project's own rule is that money never goes through a float.
	 */
	myLateFeeStroops: bigint;
	/**
	 * Ledger timestamp (unix seconds) at which THIS cycle's deposits open, or
	 * null when the contract could not tell us.
	 *
	 * A cycle can settle well before its length elapses — the recipient should
	 * not wait for money the group has already collected — so the SCHEDULE is
	 * carried by the next round's deposit window instead. `contribute` reverts
	 * with `CycleNotOpen` before this time.
	 *
	 * NULL MEANS UNKNOWN, NOT CLOSED. `deposits_open_at` only exists on
	 * contracts deployed from the current source; against an older deployment
	 * the call fails, and the UI must fall back to letting the member try
	 * rather than locking everyone out of a circle that is actually open. The
	 * contract stays the real gate either way.
	 */
	depositsOpenAt: number | null;
	/**
	 * The address the contract will actually pay next, or null once everyone
	 * has been paid.
	 *
	 * Read from `next_recipient` rather than recomputed. The contract picks the
	 * recipient by SCANNING for the first member who is neither defaulted nor
	 * already paid — deliberately not by indexing the member vec with the cycle
	 * number, so that removing a member never mis-assigns or double-pays a slot.
	 * The UI used to reimplement the abandoned index math
	 * (`position - 1 === currentCycle`) against a `removed` flag the indexer
	 * never set, so after any removal it named the wrong person as "Current".
	 */
	nextRecipient: string | null;
};

const READONLY_SOURCE =
	"GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF5";

function toNum(v: unknown): number {
	// i128/u32 come back as bigint or number depending on the binding.
	if (typeof v === "bigint") return Number(v);
	if (typeof v === "number") return v;
	return Number(v ?? 0);
}

/**
 * Read a circle's LIVE state directly from the chain, bypassing the DB/indexer,
 * so the UI reflects on-chain truth instantly after an action instead of waiting
 * for the backend to reconcile. All reads run in parallel. Returns null until the
 * first read resolves (or if there's no on-chain id yet); callers overlay these
 * values on top of their DB-backed data.
 *
 * `refresh()` re-reads immediately — call it right after contribute/claim/start.
 */
export function useLiveCircle(onchainGroupId: number | null | undefined) {
	const [live, setLive] = useState<LiveCircle | null>(null);
	const [loading, setLoading] = useState(false);

	const refresh = useCallback(async () => {
		if (onchainGroupId === null || onchainGroupId === undefined) {
			setLive(null);
			return;
		}
		setLoading(true);
		try {
			const me = (await currentAddress()) ?? undefined;
			const client = savingsClient(me ?? READONLY_SOURCE);
			const gid = BigInt(onchainGroupId);

			// Group state + cycle + pool + members, in parallel.
			const [groupTx, cycleTx, poolTx, membersTx] = await Promise.all([
				client.get_group({ group_id: gid }),
				client.get_cycle({ group_id: gid }),
				client.get_pool({ group_id: gid }),
				client.get_members({ group_id: gid }),
			]);

			const g = groupTx.result as unknown;
			const config =
				g && typeof g === "object" && "unwrap" in g
					? (g as { unwrap: () => { status?: number } }).unwrap()
					: (g as { status?: number });
			const status = typeof config?.status === "number" ? config.status : 0;
			const cycle = toNum(cycleTx.result);
			const pool = toNum(poolTx.result) / 10_000_000;
			const members = (membersTx.result ?? []) as string[];

			// When this cycle's deposits open. Tolerated as unknown: an older
			// deployed contract has no such function, and failing closed here
			// would block contributions on a circle that is genuinely open.
			let depositsOpenAt: number | null = null;
			try {
				const opensTx = await client.deposits_open_at({ group_id: gid });
				const raw = opensTx.result as bigint | number | undefined;
				depositsOpenAt = raw === undefined ? null : Number(raw);
			} catch {
				depositsOpenAt = null;
			}

			// The contract's own answer for whose turn it is. `next_recipient`
			// returns GroupNotFound (#1) when nobody is left to pay, which the
			// bindings surface as an Err — treat that as "no one", not a failure.
			let nextRecipient: string | null = null;
			try {
				const nextTx = await client.next_recipient({ group_id: gid });
				const r = nextTx.result as unknown;
				const unwrapped =
					r && typeof r === "object" && "unwrap" in r
						? (r as { unwrap: () => string }).unwrap()
						: (r as string | undefined);
				nextRecipient = typeof unwrapped === "string" ? unwrapped : null;
			} catch {
				nextRecipient = null;
			}

			// Per-member reads (only if a wallet is connected).
			let myClaimable = 0;
			let paidThisCycle = false;
			let myLateFeeStroops = 0n;
			if (me) {
				const [claimTx, paidTx, lateTx] = await Promise.all([
					client.claimable_of({ group_id: gid, member: me }),
					client.has_contributed({ group_id: gid, cycle, member: me }),
					client.late_fee_of({ group_id: gid, member: me }),
				]);
				myClaimable = toNum(claimTx.result) / 10_000_000;
				paidThisCycle = !!paidTx.result;
				myLateFeeStroops = BigInt((lateTx.result as bigint | number) ?? 0);
			}

			setLive({
				status,
				cycle,
				pool,
				members,
				myClaimable,
				paidThisCycle,
				myLateFeeStroops,
				nextRecipient,
				depositsOpenAt,
			});
		} catch {
			// RPC hiccup — keep the last snapshot; DB data still renders.
		} finally {
			setLoading(false);
		}
	}, [onchainGroupId]);

	useEffect(() => {
		refresh();
	}, [refresh]);

	return { live, loading, refresh };
}
