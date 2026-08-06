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
