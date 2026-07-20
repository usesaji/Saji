<?php

namespace App\Http\Controllers;

use App\Models\Contribution;
use App\Models\Group;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class ContributionController extends Controller
{
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

        // TODO(M2): StellarService::contribute() -> submit tx, store hash.

        return response()->json($contribution, $contribution->wasRecentlyCreated ? 201 : 200);
    }
}
