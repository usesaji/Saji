<?php

namespace App\Http\Controllers;

use App\Models\Contribution;
use App\Models\Group;
use App\Services\Stellar\StellarService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class ContributionController extends Controller
{
    public function __construct(private readonly StellarService $stellar) {}

    /** Contributions the authenticated user has made to a group. */
    public function index(Request $request, Group $group): JsonResponse
    {
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
        // contribute. Build the unsigned tx for the frontend to sign; it then
        // posts the signed XDR back to POST /groups/{group}/submit (type
        // "contribution"), which broadcasts it. The indexer flips this row to
        // 'confirmed' when the `contributed` event lands. Requires the member to
        // have linked a wallet and the group to be live on-chain.
        $unsignedXdr = null;
        if ($user->stellar_address && $group->onchain_group_id !== null) {
            $unsignedXdr = $this->stellar->buildContributeTx(
                member: $user->stellar_address,
                groupId: $group->onchain_group_id,
            );
        }

        return response()->json([
            'contribution' => $contribution,
            'unsigned_xdr' => $unsignedXdr,
        ], $contribution->wasRecentlyCreated ? 201 : 200);
    }
}
