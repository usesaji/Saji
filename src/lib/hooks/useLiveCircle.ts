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

			// Per-member reads (only if a wallet is connected).
			let myClaimable = 0;
			let paidThisCycle = false;
			if (me) {
				const [claimTx, paidTx] = await Promise.all([
					client.claimable_of({ group_id: gid, member: me }),
					client.has_contributed({ group_id: gid, cycle, member: me }),
				]);
				myClaimable = toNum(claimTx.result) / 10_000_000;
				paidThisCycle = !!paidTx.result;
			}

			setLive({ status, cycle, pool, members, myClaimable, paidThisCycle });
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
