<?php

namespace App\Http\Controllers;

use App\Models\Transaction;
use App\Services\Stellar\Sep24Service;
use App\Services\Stellar\StellarService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Fiat deposit via Stellar SEP-24 — the "Add money → bank transfer" path.
 *
 * NON-CUSTODIAL. The anchor delivers USDC to the user's OWN wallet; the SEP-10
 * challenge is signed by the user's connected wallet, not us. The frontend
 * drives the flow through these endpoints:
 *
 *   GET  /fiat/deposit/info      → anchor info (asset, home domain)
 *   POST /fiat/deposit/challenge → get the SEP-10 challenge XDR to sign
 *   POST /fiat/deposit/start     → exchange the signed challenge for a session
 *                                  and start the interactive deposit; returns
 *                                  the anchor URL to open + a deposit id
 *   GET  /fiat/deposit/{tx}/status → poll until USDC lands (completed)
 *
 * A deposit is recorded as a PENDING transaction; it is only funds-available
 * once the anchor reports it completed on-chain.
 */
class FiatDepositController extends Controller
{
    public function __construct(
        private readonly Sep24Service $sep24,
        private readonly StellarService $stellar,
    ) {}

    /** Anchor + asset info for the Add Money (bank transfer) screen. */
    public function info(Request $request): JsonResponse
    {
        $discovery = $this->sep24->discover();

        return response()->json([
            'method' => 'sep24',
            'asset_code' => $discovery['asset_code'],
            'anchor_home_domain' => $discovery['home_domain'],
            'wallet_linked' => (bool) $request->user()->stellar_address,
        ]);
    }

    /**
     * Step 1 — fetch the SEP-10 challenge for the user's wallet. The frontend's
     * wallet signs the returned `transaction` and posts it to start().
     */
    public function challenge(Request $request): JsonResponse
    {
        $user = $request->user();
        abort_if(! $user->stellar_address, 422, 'Link a Stellar wallet before depositing.');

        $challenge = $this->sep24->authChallenge($user->stellar_address);

        return response()->json([
            'transaction' => $challenge['transaction'],
            'network_passphrase' => $challenge['network_passphrase'],
        ]);
    }

    /**
     * Step 2 — exchange the wallet-signed challenge for a SEP-10 session, start
     * the interactive deposit, and record it as a pending transaction. Returns
     * the anchor interactive URL the user opens + our transaction id to poll.
     *
     * The session JWT is returned to the frontend to use for polling; it is a
     * short-lived, account-scoped token (not a Saji credential), so the client
     * holds it for the duration of this deposit.
     */
    public function start(Request $request): JsonResponse
    {
        $user = $request->user();
        abort_if(! $user->stellar_address, 422, 'Link a Stellar wallet before depositing.');

        $data = $request->validate([
            'signed_challenge_xdr' => ['required', 'string'],
            'amount' => ['nullable', 'numeric', 'min:0.0000001'],
        ]);

        $token = $this->sep24->authToken($data['signed_challenge_xdr']);

        $deposit = $this->sep24->startDeposit(
            token: $token,
            account: $user->stellar_address,
            amount: isset($data['amount']) ? (string) $data['amount'] : null,
        );

        // Record the deposit so it appears in history / can be polled. Pending
        // until the anchor confirms USDC delivery on-chain.
        $tx = Transaction::create([
            'user_id' => $user->id,
            'type' => 'other',
            // The anchor's SEP-24 id is unique; prefix so it can't collide with
            // real Stellar tx hashes recorded elsewhere.
            'stellar_tx_hash' => 'sep24:'.$deposit['id'],
            'status' => 'pending',
            'meta' => ['kind' => 'fiat_deposit', 'anchor_id' => $deposit['id']],
        ]);

        return response()->json([
            'transaction_id' => $tx->id,
            'anchor_deposit_id' => $deposit['id'],
            'interactive_url' => $deposit['url'],
            'session_token' => $token,
        ], 201);
    }

    /**
     * Step 3 — poll the deposit's status. Once the anchor reports `completed`,
     * flip our transaction row to success and stamp the settling Stellar tx.
     */
    public function status(Request $request, Transaction $transaction): JsonResponse
    {
        abort_unless($transaction->user_id === $request->user()->id, 404);

        $data = $request->validate([
            'session_token' => ['required', 'string'],
        ]);

        $anchorId = $transaction->meta['anchor_id'] ?? null;
        abort_if(! $anchorId, 422, 'This transaction is not a fiat deposit.');

        $result = $this->sep24->transaction($data['session_token'], $anchorId);

        // Terminal success: USDC delivered on-chain.
        if ($result['status'] === 'completed' && $transaction->status !== 'success') {
            $update = ['status' => 'success'];
            if ($result['stellar_transaction_id']) {
                $update['stellar_tx_hash'] = $result['stellar_transaction_id'];
                $update['explorer_url'] = $this->stellar->explorerUrl($result['stellar_transaction_id']);
            }
            $transaction->update($update);
        } elseif (in_array($result['status'], ['error', 'refunded', 'expired'], true)) {
            $transaction->update(['status' => 'failed']);
        }

        return response()->json([
            'transaction_id' => $transaction->id,
            'anchor_status' => $result['status'],
            'status' => $transaction->fresh()->status,
            'amount_out' => $result['amount_out'],
            'stellar_transaction_id' => $result['stellar_transaction_id'],
        ]);
    }
}
