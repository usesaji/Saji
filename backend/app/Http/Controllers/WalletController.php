<?php

namespace App\Http\Controllers;

use App\Models\Transaction;
use App\Services\Stellar\StellarService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * The Wallet page — NON-CUSTODIAL.
 *
 * Saji never holds a user's funds or keys. So "balance" is a live read of the
 * user's OWN linked Stellar wallet, "fund account" hands back the address to
 * send funds to (+ an on-ramp link), and "withdraw" builds an unsigned payment
 * the user's connected wallet signs. History is the user's on-chain activity.
 */
class WalletController extends Controller
{
    public function __construct(private readonly StellarService $stellar) {}

    /** Balance + amount for the Wallet header. Reads the chain, not a ledger. */
    public function balance(Request $request): JsonResponse
    {
        $user = $request->user();

        if (! $user->stellar_address) {
            // No wallet linked yet — nothing to read on-chain.
            return response()->json([
                'linked' => false,
                'stellar_address' => null,
                'amount' => null,
                'asset_code' => 'USDC',
            ]);
        }

        $stroops = $this->stellar->balanceOf($user->stellar_address);

        return response()->json([
            'linked' => true,
            'stellar_address' => $user->stellar_address,
            // 7-dp decimal string for display.
            'amount' => number_format($stroops / 10_000_000, 7, '.', ''),
            'asset_code' => 'USDC',
        ]);
    }

    /**
     * "Fund account": where and how to add funds. Non-custodial — the user
     * sends to their OWN address; we just surface it plus an optional on-ramp.
     */
    public function fund(Request $request): JsonResponse
    {
        $user = $request->user();

        abort_if(! $user->stellar_address, 422, 'Link a Stellar wallet before funding.');

        return response()->json([
            'stellar_address' => $user->stellar_address,
            'asset_code' => 'USDC',
            'memo' => null, // self-custody: no routing memo needed
            'onramp_url' => config('services.stellar.onramp_url'),
            'note' => 'Send USDC on the Stellar network to this address.',
        ]);
    }

    /**
     * "Withdraw": build an unsigned payment from the user's wallet to a
     * destination. The user's wallet signs it; then the signed XDR is posted to
     * submitWithdraw() to broadcast. Defaults the destination to the user's
     * saved Withdraw Info when none is supplied.
     */
    public function withdraw(Request $request): JsonResponse
    {
        $user = $request->user();

        abort_if(! $user->stellar_address, 422, 'Link a Stellar wallet before withdrawing.');

        $data = $request->validate([
            'amount' => ['required', 'numeric', 'min:0.0000001'],
            'destination' => ['nullable', 'string', 'regex:/^G[A-Z2-7]{55}$/'],
        ], [
            'destination.regex' => 'That is not a valid Stellar public address.',
        ]);

        $destination = $data['destination']
            ?? $user->withdrawInfo?->stellar_address;

        abort_if(! $destination, 422, 'No withdrawal destination set. Add one in Withdraw Info.');

        $unsignedXdr = $this->stellar->buildWithdrawTx(
            from: $user->stellar_address,
            to: $destination,
            amount: (int) round((float) $data['amount'] * 10_000_000),
        );

        return response()->json([
            'unsigned_xdr' => $unsignedXdr,
            'destination' => $destination,
            'amount' => number_format((float) $data['amount'], 7, '.', ''),
        ]);
    }

    /**
     * Broadcast the wallet-signed withdrawal and log it. A withdrawal leaves
     * Saji as a payout-type transaction to the user's own wallet.
     */
    public function submitWithdraw(Request $request): JsonResponse
    {
        $data = $request->validate([
            'signed_xdr' => ['required', 'string'],
        ]);

        $result = $this->stellar->submitSigned($data['signed_xdr']);

        $tx = Transaction::create([
            'user_id' => $request->user()->id,
            'type' => 'payout', // withdrawal == payout to the member's wallet
            'stellar_tx_hash' => $result['hash'],
            'status' => $result['status'] === 'SUCCESS' ? 'success' : 'pending',
            'explorer_url' => $this->stellar->explorerUrl($result['hash']),
            'meta' => ['kind' => 'withdrawal'],
        ]);

        return response()->json($tx, 201);
    }

    /** Wallet history: the user's on-chain transactions, newest first. */
    public function history(Request $request): JsonResponse
    {
        $data = $request->validate([
            'per_page' => ['nullable', 'integer', 'min:1', 'max:100'],
        ]);

        $history = Transaction::query()
            ->where('user_id', $request->user()->id)
            ->with('group:id,name')
            ->latest()
            ->paginate($data['per_page'] ?? 20);

        return response()->json($history);
    }
}
