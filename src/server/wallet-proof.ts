/**
 * Proof-of-control for linking a Stellar wallet address.
 *
 * `PATCH /api/profile/wallet` used to accept any syntactically valid G...
 * address with no verification that the caller actually holds its key — a
 * direct API call (bypassing the wallet-kit's real connect handshake) could
 * link an address it doesn't control, which then becomes that account's
 * payout destination. This closes that gap the same way SEP-10 web auth
 * does: issue a random nonce inside an unsigned, UNSUBMITTABLE transaction
 * (sequence number -1 — the network would reject it outright), have the
 * wallet sign it, then verify the signature ourselves. The challenge is
 * never broadcast, so nothing is spent and no funded account is required —
 * this works even for a brand-new, empty address.
 *
 * The nonce is stored in the DB (WalletChallenge), not an in-memory Map: the
 * issuing request (POST .../wallet/challenge) and the redeeming request
 * (PATCH .../wallet) are separate HTTP calls with no guarantee of landing on
 * the same serverless instance.
 */

import { randomBytes } from "node:crypto";
import {
	Account,
	Keypair,
	Operation,
	TransactionBuilder,
} from "@stellar/stellar-sdk";
import { prisma } from "./db";
import { NETWORK_PASSPHRASE } from "./stellar/service";

const CHALLENGE_TTL_MS = 5 * 60_000;

/**
 * Build an unsigned challenge transaction for `address` to sign.
 *
 * Sequence number `-1` marks this as SEP-10-style: the network refuses to
 * ever apply it, so it is safe to hand out even though it is a fully formed,
 * signable envelope. The nonce lives in a `manageData` operation, which is
 * the standard place to carry auth-only data with no on-chain effect.
 *
 * Upserts on `address`: requesting a fresh challenge invalidates any earlier
 * unredeemed one for the same address, so a stale challenge can't be signed
 * and submitted after a newer one was already issued.
 */
export async function createWalletChallenge(address: string): Promise<string> {
	const nonce = randomBytes(24).toString("base64");

	await prisma.walletChallenge.upsert({
		where: { address },
		create: { address, nonce, expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS) },
		update: { nonce, expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS) },
	});

	const account = new Account(address, "-1");
	const tx = new TransactionBuilder(account, {
		fee: "100",
		networkPassphrase: NETWORK_PASSPHRASE,
	})
		.addOperation(
			Operation.manageData({
				name: "saji auth",
				value: nonce,
				source: address,
			}),
		)
		.setTimeout(CHALLENGE_TTL_MS / 1000)
		.build();

	return tx.toXDR();
}

/**
 * Verify a signed challenge proves control of `address`.
 *
 * Checks, in order: the envelope's source account is the address being
 * claimed (signing a challenge issued to a DIFFERENT address proves nothing
 * about this one), the nonce matches what we issued and hasn't expired, and
 * the signature over the transaction hash verifies against `address`'s own
 * public key. The row is deleted either way, so a challenge can never be
 * replayed.
 */
export async function verifyWalletChallenge(
	address: string,
	signedXdr: string,
): Promise<boolean> {
	const entry = await prisma.walletChallenge
		.delete({ where: { address } })
		.catch(() => null);

	if (!entry || entry.expiresAt < new Date()) return false;

	let tx;
	try {
		tx = TransactionBuilder.fromXDR(signedXdr, NETWORK_PASSPHRASE);
	} catch {
		return false;
	}

	if (!("source" in tx) || tx.source !== address) return false;

	const op = "operations" in tx ? tx.operations[0] : undefined;
	if (
		!op ||
		op.type !== "manageData" ||
		op.name !== "saji auth" ||
		op.value?.toString() !== entry.nonce
	) {
		return false;
	}

	const signature = tx.signatures[0];
	if (!signature) return false;

	try {
		const keypair = Keypair.fromPublicKey(address);
		return keypair.verify(tx.hash(), signature.signature());
	} catch {
		return false;
	}
}
