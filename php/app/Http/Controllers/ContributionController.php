<?php

namespace App\Http\Controllers;

use App\Http\Controllers\Concerns\SpawnsChainReconcile;
use App\Models\Contribution;
use App\Models\Group;
use App\Services\Stellar\ChainIndexer;
use App\Services\Stellar\StellarService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class ContributionController extends Controller
{
    use SpawnsChainReconcile;

    public function __construct(
        private readonly StellarService $stellar,
        private readonly ChainIndexer $indexer,
    ) {}

    /** Contributions the authenticated user has made to a group. */
    public function index(Request $request, Group $group): JsonResponse
    {
        abort_unless($group->isVisibleTo($request->user()), 403, 'You are not a member of this group.');

        $contributions = $group->contributions()
            ->where('user_id', $request->user()->id)
            ->latest()
            ->get();

        return response()->json($contributions);
    }

    /**
     * Record a member's intent to contribute for the current cycle.
     *
     * The actual on-chain transfer is submitted by StellarService in a later
     * milestone; the chain indexer then flips status -> confirmed. For now we
     * create the 'pending' row so the flow is exercisable and idempotent
     * (one contribution per member per cycle, enforced by the unique index).
     */
    public function store(Request $request, Group $group): JsonResponse
    {
        $user = $request->user();

        // Rotating-circle contributions only. A public challenge has no pooled
        // contribution — members save to their own wallets via the challenge
        // deposit endpoint instead.
        abort_if($group->isChallenge(), 422, 'This is a savings challenge, not a rotating circle. Use the challenge deposit endpoint.');

        abort_unless(
            $group->members()->where('user_id', $user->id)->where('status', 'approved')->exists(),
            403,
            'You are not an approved member of this group.'
        );

        $contribution = Contribution::firstOrCreate(
            [
                'group_id' => $group->id,
                'user_id' => $user->id,
                'cycle' => $group->current_cycle,
            ],
            [
                'amount' => $group->contribution_amount,
                'status' => 'pending',
            ]
        );

        // Non-custodial: the MEMBER's connected wallet signs the on-chain
        // contribute. We can optionally build the unsigned tx here (legacy
        // backend-XDR flow), but the frontend now settles on-chain DIRECTLY via
        // the contract bindings, so this endpoint's real job is just to record
        // the intent row. Building the XDR is best-effort — if it fails (e.g. the
        // host can't reach the RPC), we still return the recorded contribution
        // rather than 500, and the frontend proceeds with its own signing.
        $unsignedXdr = null;
        if ($user->stellar_address && $group->onchain_group_id !== null) {
            try {
                $unsignedXdr = $this->stellar->buildContributeTx(
                    member: $user->stellar_address,
                    groupId: $group->onchain_group_id,
                );
            } catch (\Throwable $e) {
                // Non-fatal: the frontend builds + signs the contribution itself.
                report($e);
            }
        }

        return response()->json([
            'contribution' => $contribution,
            'unsigned_xdr' => $unsignedXdr,
        ], $contribution->wasRecentlyCreated ? 201 : 200);
    }

    /**
     * Ask the backend to reconcile this group with the chain now (e.g. right
     * after the member settled a contribution on-chain from the frontend).
     *
     * SECURITY: this endpoint does NOT trust the caller's word that they paid.
     * It triggers the ChainIndexer, which reads the CONTRACT (`has_contributed`)
     * and only confirms contributions the chain actually shows as paid. So a
     * member cannot mark themselves paid without a real on-chain transfer — the
     * chain is the sole authority for `confirmed` state.
     *
     * It's just a "reconcile faster than the scheduled run" trigger; the periodic
     * indexer would reach the same state within a minute regardless.
     */
    public function confirm(Request $request, Group $group): JsonResponse
    {
        $user = $request->user();

        // Must be an approved member of this group to even ask.
        abort_unless(
            $group->members()->where('user_id', $user->id)->where('status', 'approved')->exists(),
            403,
            'You are not an approved member of this group.'
        );

        // Reconcile from chain so the record shows immediately. We try inline
        // first (works when the host can reach the RPC), but the artisan-serve
        // web worker often CAN'T resolve DNS to the RPC (the "DNS wall"). So we
        // ALSO spawn a detached `chain:index --group=` in a standalone php
        // process, which CAN reach the RPC — it finishes reconciling within a
        // second or two even if the inline attempt failed. Either way the
        // request returns right away.
        if ($group->onchain_group_id !== null) {
            $reconciled = false;
            try {
                $this->indexer->reconcileGroup($group);
                $reconciled = true;
            } catch (\Throwable $e) {
                report($e); // inline read blocked (DNS wall) — the spawn covers it.
            }
            // If the inline reconcile couldn't reach the chain, hand off to a
            // standalone process that can, so the record still lands immediately.
            if (! $reconciled) {
                $this->spawnReconcile($group->id);
            }
        }

        // Return the member's current-cycle contribution AS THE CHAIN LEFT IT.
        $contribution = $group->contributions()
            ->where('user_id', $user->id)
            ->where('cycle', $group->fresh()->current_cycle)
            ->first();

        return response()->json($contribution);
    }

}
