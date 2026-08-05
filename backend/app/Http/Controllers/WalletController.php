<?php

namespace App\Http\Controllers;

use App\Models\Group;
use App\Models\Transaction;
use App\Services\Stellar\StellarService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * The Wallet page — NON-CUSTODIAL.
 *
 * Saji never holds a user's funds or keys. So "balance" is a live read of the
 * user's OWN linked Stellar wallet, and "withdraw" builds an unsigned payment
 * the user's connected wallet signs. History is the user's on-chain activity.
 * There is no "fund"/deposit-address step: funding is connect-wallet + sign,
 * and the savings contract pulls the funds directly on contribution.
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

        // Live chain read — best-effort. If the RPC/CLI can't be reached, return
        // a null amount rather than 500 so the wallet screen still renders the
        // linked address and history.
        $amount = null;
        try {
            $stroops = $this->stellar->balanceOf($user->stellar_address);
            $amount = number_format($stroops / 10_000_000, 7, '.', '');
        } catch (\Throwable $e) {
            report($e);
        }

        return response()->json([
            'linked' => true,
            'stellar_address' => $user->stellar_address,
            'amount' => $amount,
            'asset_code' => 'USDC',
        ]);
    }

    /**
     * "Saji balance" — the user's withdrawable money, broken down PER ASSET
     * (XLM, USDC, USDT). Different tokens can't be summed into one figure, so
     * each asset carries its own wallet balance + claimable circle payouts +
     * total + the circles that make up its claimable. Non-custodial: claimable
     * funds sit escrowed in the contract, not with Saji.
     */
    public function sajiBalance(Request $request): JsonResponse
    {
        $user = $request->user();

        // Assets the app supports, mapped to their token contract (SAC) address.
        $tokenSacs = (array) config('services.stellar.token_sacs', []);

        if (! $user->stellar_address) {
            return response()->json([
                'linked' => false,
                'assets' => [],
            ]);
        }

        // The user's live circles, so we can attribute claimables to an asset.
        $groups = Group::query()
            ->whereNotNull('onchain_group_id')
            ->whereHas('members', fn ($q) => $q->where('user_id', $user->id)->where('status', 'approved'))
            ->get(['id', 'name', 'onchain_group_id', 'asset_code']);

        $assets = [];
        foreach ($tokenSacs as $code => $sac) {
            // Wallet balance for THIS token (each asset read against its own SAC).
            $walletAmount = null;
            try {
                $walletAmount = $this->stellar->balanceOf($user->stellar_address, $sac) / 10_000_000;
            } catch (\Throwable $e) {
                report($e);
            }

            // Claimable circle payouts denominated in this asset.
            $claimables = [];
            $claimableTotal = 0.0;
            foreach ($groups->where('asset_code', $code) as $group) {
                try {
                    $stroops = $this->stellar->claimableOf((int) $group->onchain_group_id, $user->stellar_address);
                } catch (\Throwable $e) {
                    report($e);

                    continue;
                }
                if ($stroops <= 0) {
                    continue;
                }
                $claimableTotal += $stroops / 10_000_000;
                $claimables[] = [
                    'group_id' => $group->id,
                    'onchain_group_id' => (int) $group->onchain_group_id,
                    'group_name' => $group->name,
                    'asset_code' => $code,
                    'amount' => number_format($stroops / 10_000_000, 7, '.', ''),
                ];
            }

            $total = $walletAmount !== null ? $walletAmount + $claimableTotal : null;

            $assets[] = [
                'asset_code' => $code,
                'wallet_amount' => $walletAmount !== null ? number_format($walletAmount, 7, '.', '') : null,
                'claimable_total' => number_format($claimableTotal, 7, '.', ''),
                'total' => $total !== null ? number_format($total, 7, '.', '') : null,
                'claimables' => $claimables,
            ];
        }

        return response()->json([
            'linked' => true,
            'assets' => $assets,
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

        $tokenSacs = (array) config('services.stellar.token_sacs', []);

        $data = $request->validate([
            'amount' => ['required', 'numeric', 'min:0.0000001'],
            'destination' => ['nullable', 'string', 'regex:/^G[A-Z2-7]{55}$/'],
            // Which asset to withdraw; defaults to USDC for back-compat.
            'asset_code' => ['nullable', 'string', 'in:'.implode(',', array_keys($tokenSacs))],
        ], [
            'destination.regex' => 'That is not a valid Stellar public address.',
            'asset_code.in' => 'That asset is not supported for withdrawal.',
        ]);

        $assetCode = $data['asset_code'] ?? 'USDC';
        $token = $tokenSacs[$assetCode] ?? null;
        abort_if(! $token, 422, "No token address configured for {$assetCode}.");

        $destination = $data['destination']
            ?? $user->withdrawInfo?->stellar_address;

        abort_if(! $destination, 422, 'No withdrawal destination set. Add one in Withdraw Info.');

        // The frontend needs this XDR to sign, so a build failure is fatal here —
        // but surface a clean message instead of a raw CLI error string.
        try {
            $unsignedXdr = $this->stellar->buildWithdrawTx(
                from: $user->stellar_address,
                to: $destination,
                amount: (int) round((float) $data['amount'] * 10_000_000),
                token: $token,
            );
        } catch (\Throwable $e) {
            report($e);

            return response()->json([
                'message' => 'Could not reach the network to prepare the withdrawal. Please try again shortly.',
            ], 503);
        }

        return response()->json([
            'unsigned_xdr' => $unsignedXdr,
            'destination' => $destination,
            'asset_code' => $assetCode,
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

        // We broadcast the user's OWN signed payment (self-custody — they can
        // only move their own funds). The returned hash/status come straight
        // from the RPC, not the client. sendTransaction returns PENDING; the tx
        // only becomes final on-chain shortly after, so we record it as pending
        // and let confirmation land later (the indexer / a status poll) rather
        // than optimistically claiming success on the client's round-trip.
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

    /**
     * Log a withdrawal that was built + broadcast CLIENT-SIDE (via Horizon in the
     * browser, to sidestep the DNS wall). The frontend already has the real
     * on-chain hash; we just record the Transaction so it shows in history. The
     * indexer's tx-status finalizer flips it to success/failed from chain.
     */
    public function logWithdrawal(Request $request): JsonResponse
    {
        $data = $request->validate([
            'tx_hash' => ['required', 'string', 'max:255'],
            'amount' => ['required', 'numeric', 'min:0.0000001'],
            'asset_code' => ['nullable', 'string', 'max:12'],
        ]);

        $tx = Transaction::create([
            'user_id' => $request->user()->id,
            'type' => 'payout', // a withdrawal leaves the wallet to the destination
            'stellar_tx_hash' => $data['tx_hash'],
            'status' => 'pending', // finalized by the indexer from chain
            'explorer_url' => $this->stellar->explorerUrl($data['tx_hash']),
            'meta' => [
                'kind' => 'withdrawal',
                'amount' => (string) $data['amount'],
                'asset_code' => $data['asset_code'] ?? 'USDC',
            ],
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
