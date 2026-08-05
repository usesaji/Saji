"use client";

/* eslint-disable @next/next/no-img-element */
import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { HiArrowsUpDown, HiXMark } from "react-icons/hi2";
import GoBack from "@/components/dashboard/GoBack";
import { Button } from "@/components/ui/button";
import { useApi } from "@/lib/hooks/useApi";
import { groups as groupsApi, ApiError } from "@/lib/api";
import { useSavingsContract } from "@/lib/hooks/useSavingsContract";
import { pageRoutes } from "@/config/routes";
import { toast } from "@/lib/utils/toast";

const AVATAR = "/images/user.jpg";

type Member = { userId: number; name: string; address: string | null };

/**
 * "Who gets paid first?" — the organizer drags members into the payout order,
 * or shuffles them randomly. Saving records the order (setPayoutOrder) and, for
 * a Manual on-chain group, signs the on-chain reorder.
 */
export default function PayoutOrderPage() {
	const { groupId } = useParams<{ groupId: string }>();
	const router = useRouter();
	const { setPayoutOrder: setPayoutOrderOnchain, getOnchainState } =
		useSavingsContract();

	const fetcher = useCallback(
		() => groupsApi.show(Number(groupId)),
		[groupId],
	);
	const { data, loading } = useApi(fetcher, [groupId]);

	const [order, setOrder] = useState<Member[]>([]);
	const [dragIndex, setDragIndex] = useState<number | null>(null);
	const [saving, setSaving] = useState(false);
	const [showRandomized, setShowRandomized] = useState(false);
	// Members approved in the app but not yet added to the contract. The chain
	// rejects any order that isn't an exact permutation of ITS member list, so
	// surface this before the organizer bothers arranging anyone.
	const [notOnchain, setNotOnchain] = useState<string[]>([]);

	useEffect(() => {
		if (!data?.onchain_group_id && data?.onchain_group_id !== 0) return;
		let cancelled = false;
		(async () => {
			const chain = await getOnchainState(data.onchain_group_id!);
			if (cancelled || !chain) return;
			const onchain = new Set(chain.members.map((a) => a.toLowerCase()));
			const missing = (data.members ?? [])
				.filter((m) => m.status === "approved")
				.filter((m) => {
					const a = m.user?.stellar_address;
					return !a || !onchain.has(a.toLowerCase());
				})
				.map((m) => m.user?.name ?? "Member");
			setNotOnchain(missing);
		})();
		return () => {
			cancelled = true;
		};
	}, [data, getOnchainState]);

	// Seed the order from approved members once loaded.
	useEffect(() => {
		if (!data?.members) return;
		const approved = data.members
			.filter((m) => m.status === "approved")
			.map((m) => ({
				userId: m.user_id,
				name: m.user?.name ?? "Member",
				address: m.user?.stellar_address ?? null,
			}));
		setOrder(approved);
	}, [data]);

	// --- drag handlers (HTML5 native) ---
	const onDrop = (index: number) => {
		if (dragIndex === null || dragIndex === index) return;
		setOrder((prev) => {
			const next = [...prev];
			const [moved] = next.splice(dragIndex, 1);
			next.splice(index, 0, moved);
			return next;
		});
		setDragIndex(null);
	};

	const randomize = () => {
		setOrder((prev) => {
			const next = [...prev];
			for (let i = next.length - 1; i > 0; i--) {
				const j = Math.floor(Math.random() * (i + 1));
				[next[i], next[j]] = [next[j], next[i]];
			}
			return next;
		});
		setShowRandomized(true);
	};

	const save = async () => {
		if (!data) return;
		setSaving(true);
		try {
			// 1. Persist the order in the DB (positions). Backend build of the
			//    on-chain reorder is best-effort there — we do the on-chain part
			//    here, client-side, so it doesn't route the RPC through the server.
			await groupsApi.setPayoutOrder(
				data.id,
				order.map((m) => m.userId),
			);

			// 2. For a Manual group that is live on-chain, freeze the order on the
			//    contract (organizer signs). Requires every member to have a linked
			//    wallet so the on-chain permutation is complete.
			const isManual = (data.payout_order ?? "manual") === "manual";
			const isLive =
				data.onchain_group_id !== null && data.onchain_group_id !== undefined;
			const addresses = order.map((m) => m.address);
			const allHaveWallets = addresses.every((a): a is string => !!a);

			if (isManual && isLive) {
				if (!allHaveWallets) {
					toast.error(
						"Every member needs a linked wallet before the payout order can be set on-chain. The order is saved and will apply once they connect.",
						"Saved (not yet on-chain)",
					);
					router.push(pageRoutes.dashboardRoutes.GROUP(String(groupId)));
					return;
				}

				// The contract requires `order` to be an exact permutation of its OWN
				// member list. Approving someone in the app doesn't add them on-chain
				// (that's the organizer's separate "Add to chain" step), so check
				// first — otherwise this fails at signing time as an opaque #12.
				const chain = await getOnchainState(data.onchain_group_id!);
				const onchain = new Set(
					(chain?.members ?? []).map((a) => a.toLowerCase()),
				);
				const missing = order.filter(
					(m) => !m.address || !onchain.has(m.address.toLowerCase()),
				);
				if (missing.length > 0) {
					toast.error(
						`${missing.map((m) => m.name).join(", ")} ${
							missing.length === 1 ? "is" : "are"
						} not on-chain yet. The organizer must "Add to chain" for each member on the group page before the payout order can be set. Your order is saved.`,
						"Saved (not yet on-chain)",
					);
					router.push(pageRoutes.dashboardRoutes.GROUP(String(groupId)));
					return;
				}

				await setPayoutOrderOnchain(
					data.onchain_group_id!,
					addresses as string[],
				);
			}

			toast.success("Payout order saved.", "Saved");
			router.push(pageRoutes.dashboardRoutes.GROUP(String(groupId)));
		} catch (err) {
			const msg = err instanceof Error ? err.message : "";
			if (/Connect your wallet/i.test(msg)) {
				toast.error("Connect your wallet to set the order on-chain.", "Wallet not connected");
			} else if (/User (declined|rejected)|cancell?ed/i.test(msg)) {
				toast.error("You cancelled the signature.", "Cancelled");
			} else if (/#13\b|OrderNotManual/i.test(msg)) {
				toast.error("This group's payout order isn't Manual, so it can't be set by hand.", "Not manual");
			} else if (/#5\b|WrongStatus/i.test(msg)) {
				toast.error("The cycle has already started — the order is locked.", "Too late");
			} else if (/#12\b|InvalidOrder/i.test(msg)) {
				toast.error(
					"The on-chain member list doesn't match this order — someone approved in the app hasn't been added to the chain yet.",
					"Members out of sync",
				);
			} else {
				toast.error(
					err instanceof ApiError ? err.message : msg || "Could not save the order.",
					"Failed",
				);
			}
		} finally {
			setSaving(false);
		}
	};

	return (
		<div className="mx-auto max-w-3xl pb-10">
			<GoBack />
			<h2 className="mt-4 text-lg font-medium md:text-2xl">
				Who gets paid first?
			</h2>
			<p className="mt-1 text-xs font-light text-muted-foreground md:text-sm">
				Drag and drop members into the payout order. The person at the top
				receives the first payout.
			</p>

			{notOnchain.length > 0 && !loading && (
				<div className="mt-4 rounded-xl bg-warning-100 px-4 py-3">
					<p className="text-sm font-medium text-warning-800">
						{notOnchain.join(", ")}{" "}
						{notOnchain.length === 1 ? "isn't" : "aren't"} on the chain yet
					</p>
					<p className="mt-1 text-xs text-warning-800">
						Approving someone in the app doesn&apos;t add them to the contract.
						Open the group page and use “Add to chain” for each of them, or the
						on-chain order can&apos;t be saved.
					</p>
					<Button
						size="sm"
						variant="outline"
						className="mt-2"
						href={pageRoutes.dashboardRoutes.GROUP(String(groupId))}
					>
						Go to group
					</Button>
				</div>
			)}

			{loading ? (
				<p className="mt-6 text-sm text-muted-foreground">Loading members…</p>
			) : (
				<>
					<div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
						{order.map((m, i) => (
							<div
								key={m.userId}
								draggable
								onDragStart={() => setDragIndex(i)}
								onDragOver={(e) => e.preventDefault()}
								onDrop={() => onDrop(i)}
								className={`flex cursor-grab items-center justify-between gap-3 rounded-xl bg-[#f8f8f8] px-3 py-2.5 active:cursor-grabbing ${
									dragIndex === i ? "opacity-50" : ""
								}`}
							>
								<div className="flex min-w-0 items-center gap-2">
									<div className="h-9 w-9 shrink-0 overflow-hidden rounded-full">
										<img src={AVATAR} alt={m.name} className="h-full w-full object-cover" />
									</div>
									<span className="truncate text-sm font-medium">{m.name}</span>
								</div>
								<span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
									#{i + 1}
								</span>
							</div>
						))}
					</div>

					{/* Randomize bar */}
					<button
						type="button"
						onClick={randomize}
						className="mt-3 flex w-full items-center justify-between rounded-xl bg-[#efeaff] px-4 py-3 text-primary"
					>
						<div className="text-left">
							<p className="text-sm font-medium">Randomize Order</p>
							<p className="text-xs font-light">Shuffle the payout sequence.</p>
						</div>
						<span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-white">
							<HiArrowsUpDown />
						</span>
					</button>

					<div className="mt-6 flex gap-3">
						<Button
							variant="outline"
							className="flex-1"
							href={pageRoutes.dashboardRoutes.GROUP(String(groupId))}
						>
							Discard Draft
						</Button>
						<Button
							className="flex-1"
							isLoading={saving}
							disabled={order.length < 2}
							onClick={save}
						>
							Save &amp; Continue
						</Button>
					</div>
				</>
			)}

			{/* "Order Randomized" modal */}
			{showRandomized && (
				<div className="fixed inset-0 z-[1002] flex items-center justify-center bg-black/40 p-4">
					<div className="w-full max-w-sm rounded-2xl bg-white p-6 text-center">
						<div className="flex justify-end">
							<button
								type="button"
								onClick={() => setShowRandomized(false)}
								className="text-lg"
							>
								<HiXMark />
							</button>
						</div>
						<div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-primary text-white">
							<HiArrowsUpDown className="text-2xl" />
						</div>
						<h3 className="mt-4 text-lg font-medium">Order Randomized</h3>
						<p className="mt-2 text-sm text-muted-foreground">
							The payout sequence has been shuffled. You can still drag to
							fine-tune it before saving.
						</p>
						<Button className="mt-5 w-full" onClick={() => setShowRandomized(false)}>
							Got it
						</Button>
					</div>
				</div>
			)}
		</div>
	);
}
