"use client";

import { Button } from "../../components/ui/button";
import { useWallet } from "../../lib/hooks/useWallet";

/** Truncate a Stellar address for display: GABC…WXYZ. */
function short(addr: string): string {
	return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
}

type Props = {
	/** The currently linked address (from profile/wallet), if any. */
	linkedAddress?: string | null;
	/** Called after a successful connect/disconnect so the parent can refetch. */
	onChange?: () => void;
	className?: string;
};

/**
 * Connect / disconnect the user's Stellar wallet. On connect it links the
 * address to the backend (via useWallet); on success it calls onChange so the
 * parent screen re-reads the linked state.
 */
export default function WalletConnectButton({
	linkedAddress,
	onChange,
	className,
}: Props) {
	const { connecting, connect, disconnect } = useWallet();

	const isLinked = !!linkedAddress;

	const handleConnect = async () => {
		const addr = await connect();
		if (addr) onChange?.();
	};

	const handleDisconnect = async () => {
		await disconnect();
		onChange?.();
	};

	if (isLinked) {
		return (
			<div className={`flex items-center gap-3 ${className ?? ""}`}>
				<span className="rounded-full bg-success-50 px-3 py-1 text-xs text-success-700">
					Linked · {short(linkedAddress!)}
				</span>
				<button
					type="button"
					onClick={handleDisconnect}
					className="text-xs font-medium underline"
				>
					Disconnect
				</button>
			</div>
		);
	}

	return (
		<Button
			onClick={handleConnect}
			isLoading={connecting}
			className={className}
		>
			Connect Wallet
		</Button>
	);
}
