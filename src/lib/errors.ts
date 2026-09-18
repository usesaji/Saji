/**
 * Turning an unknown thrown value into a message worth showing a user.
 *
 * The `catch (err)` binding is typed `unknown` because JS lets you throw
 * anything. The tempting shorthand
 *
 *   const raw = err instanceof Error ? err.message : "";
 *
 * silently discards every non-Error throw — a rejected wallet promise that
 * settles with a plain object, a string from a binding, an RPC payload — and
 * leaves the caller matching its guidance patterns against "". Everything
 * falls through to the generic "Something went wrong", which is exactly the
 * case where the real detail was most needed. Worse, the detail is gone: it
 * was never logged, so there's nothing left to debug from.
 */

/**
 * Best-effort human-readable message for anything a `catch` can receive.
 *
 * Returns "" only when the value genuinely carries no information (null,
 * undefined, or an object that serializes to nothing) — so a caller testing
 * `if (!message)` still distinguishes "no detail" from "detail we couldn't
 * pattern-match".
 */
export function errorMessage(err: unknown): string {
	if (err === null || err === undefined) return "";
	if (typeof err === "string") return err.trim();
	if (err instanceof Error) return err.message.trim();

	// Wallet kits and RPC clients commonly reject with a bare object carrying
	// `message`/`error`/`detail` rather than a real Error.
	if (typeof err === "object") {
		const bag = err as Record<string, unknown>;
		for (const key of ["message", "error", "detail", "description"]) {
			const value = bag[key];
			if (typeof value === "string" && value.trim()) return value.trim();
			// e.g. { error: { message: "..." } }
			if (value && typeof value === "object") {
				const nested = (value as Record<string, unknown>).message;
				if (typeof nested === "string" && nested.trim()) return nested.trim();
			}
		}

		try {
			const json = JSON.stringify(err);
			if (json && json !== "{}") return json;
		} catch {
			// Circular or non-serializable — fall through to String().
		}
	}

	const text = String(err);
	return text === "[object Object]" ? "" : text.trim();
}

/**
 * `errorMessage`, but guaranteed non-empty so a toast never renders blank.
 * Logs anything it couldn't describe, so the detail survives in the console
 * even when the UI has to fall back to `fallback`.
 */
export function displayError(err: unknown, fallback: string): string {
	const message = errorMessage(err);
	if (message) return message;

	console.error("Unrecognized error value:", err);
	return fallback;
}

/**
 * `txBadAuth` is a classic Stellar transaction-envelope result — the network
 * rejecting the signature outright, before the contract's own logic ever
 * runs. Distinct from a contract revert (e.g. `#8 AlreadyContributed`), which
 * means the request was well-formed but the answer is no.
 *
 * The near-universal cause in this app's flow: the wallet extension had more
 * than one account, and the ACTIVE one in the extension at the moment of
 * approving drifted away from the address the transaction was actually built
 * for (read once, earlier, via `currentAddress()`) — many extensions sign
 * with whichever account is currently selected in their own UI rather than
 * strictly enforcing the address the calling site requested. The result is a
 * transaction that names one account as the only valid signer, signed by a
 * different one's key.
 *
 * Without this, the raw error surfaces as an unrecognized JSON dump via
 * `displayError`'s fallback — technically accurate, useless to a user mid
 * wallet-approval flow.
 */
export function isBadAuthError(err: unknown): boolean {
	return /txBadAuth|"name":\s*"txBadAuth"|_switch.*txBadAuth/i.test(
		errorMessage(err),
	);
}

export const BAD_AUTH_MESSAGE =
	"Your wallet signed with a different account than expected. If you have more than one account in your wallet, make sure the one connected to Saji is also the active one selected in your wallet extension, then try again.";
