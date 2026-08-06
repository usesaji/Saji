/**
 * "Withdraw": build an unsigned payment from the user's wallet to a
 * destination.
 *
 * Ported from `WalletController::withdraw`.
 *
 * Non-custodial: the user's wallet signs the XDR this returns, then posts the
 * signed envelope to `/wallet/withdraw/submit` to broadcast. The backend never
 * holds the key and can only ever build a payment FROM the user's own address.
 *
 * Defaults the destination to the user's primary saved Withdraw Info.
 */

import { z } from "zod";
import { prisma } from "@/server/db";
import { requireUser } from "@/server/auth";
import { HttpError, handle, json, parseBody } from "@/server/http";
import {
	buildWithdrawTx,
	fromStroops,
	toStroops,
	tokenSacs,
} from "@/server/stellar/service";

const schema = z.object({
	// A string, not a number: JSON numbers are doubles and cannot represent
	// every 7-dp value exactly, and the error would come straight off a
	// withdrawal amount.
	amount: z.union([
		z
			.string()
			.regex(/^\d+(\.\d{1,7})?$/, "Must be a number with at most 7 decimals"),
		z.number().positive(),
	]),
	destination: z
		.string()
		.regex(/^G[A-Z2-7]{55}$/, "That is not a valid Stellar public address.")
		.nullish(),
	asset_code: z.string().max(12).nullish(),
});

export async function POST(request: Request) {
	return handle(async () => {
		const user = await requireUser(request);

		if (!user.stellarAddress) {
			throw new HttpError(422, "Link a Stellar wallet before withdrawing.");
		}

		const data = await parseBody(request, schema);
		const sacs = tokenSacs();

		const assetCode = data.asset_code ?? "USDC";
		const token = sacs[assetCode];

		if (!token) {
			throw new HttpError(
				422,
				`No token address configured for ${assetCode}.`,
			);
		}

		// Explicit destination wins; otherwise the user's primary saved one.
		let destination = data.destination ?? null;

		if (!destination) {
			const primary = await prisma.withdrawInfo.findFirst({
				where: { userId: user.id },
				orderBy: [{ isPrimary: "desc" }, { createdAt: "desc" }],
			});
			destination = primary?.stellarAddress ?? null;
		}

		if (!destination) {
			throw new HttpError(
				422,
				"No withdrawal destination set. Add one in Withdraw Info.",
			);
		}

		const amountStroops = toStroops(String(data.amount));

		if (amountStroops <= 0n) {
			throw new HttpError(422, "Withdrawal amount must be positive.");
		}

		// The frontend needs this XDR to sign, so a build failure IS fatal here
		// — but surface a clean message rather than a raw RPC error string.
		let unsignedXdr: string;
		try {
			unsignedXdr = await buildWithdrawTx(
				user.stellarAddress,
				destination,
				amountStroops,
				token,
			);
		} catch (error) {
			console.error("[wallet] withdraw build failed:", error);
			throw new HttpError(
				503,
				"Could not reach the network to prepare the withdrawal. Please try again shortly.",
			);
		}

		return json({
			unsigned_xdr: unsignedXdr,
			destination,
			asset_code: assetCode,
			amount: fromStroops(amountStroops),
		});
	});
}
