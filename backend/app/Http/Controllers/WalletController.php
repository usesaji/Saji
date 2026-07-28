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
     * "Add money" / Fund account — the payment methods the screen offers.
     *
     * Non-custodial, so there is no Saji-held account to deposit into. The two
     * methods are:
     *   1. stellar_network  — connect a wallet and send USDC to the user's OWN
     *      Stellar address (shown here, self-custody, no routing memo).
     *   2. bank_transfer     — hand off to an on-ramp provider where the user
     *      enters THEIR bank/account details; the ramp delivers USDC to their
     *      Stellar address. We never collect bank details ourselves.
     */
    public function fund(Request $request): JsonResponse
    {
        $user = $request->user();

        abort_if(! $user->stellar_address, 422, 'Link a Stellar wallet before funding.');

        return response()->json([
            'asset_code' => 'USDC',
            'methods' => [
                [
                    'method' => 'stellar_network',
                    'label' => 'Stellar network — connect wallet',
                    'stellar_address' => $user->stellar_address,
                    'memo' => null, // self-custody: no routing memo needed
                    'note' => 'Send USDC on the Stellar network to this address.',
                ],
                [
                    'method' => 'bank_transfer',
                    'label' => 'Bank transfer',
                    // Fiat deposits run through a Stellar SEP-24 anchor. The
                    // frontend drives the flow via /fiat/deposit/* (challenge →
                    // start → status); the anchor collects the user's bank
                    // details + KYC and delivers USDC to their Stellar address.
                    'flow' => 'sep24',
                    'start_endpoint' => '/api/fiat/deposit/challenge',
                    'note' => 'Complete a bank transfer with our Stellar anchor; USDC arrives on your Stellar address.',
                ],
            ],
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
