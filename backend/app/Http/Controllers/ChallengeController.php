<?php

namespace App\Http\Controllers;

use App\Models\ChallengeDeposit;
use App\Models\Group;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Progress for a public savings challenge. Each member saves their OWN money
 * (non-custodial, in their own wallet) toward the admin-set target; these
 * endpoints record and read that progress. No pool, no rotation, no penalties.
 */
class ChallengeController extends Controller
{
    /**
     * Record a save the member made toward the target. Non-custodial: the funds
     * moved within the member's own control; we store the backing on-chain tx
     * hash so progress is verifiable, not self-asserted. The row is 'pending'
     * until the tx is seen confirmed on-chain (by the indexer).
     */
    public function deposit(Request $request, Group $group): JsonResponse
    {
        $this->assertChallengeMember($request, $group);

        $data = $request->validate([
            'amount' => ['required', 'numeric', 'min:0.0000001'],
            // The on-chain transfer that backs this save (required — a challenge
            // save must correspond to real movement, per the on-chain design).
            'stellar_tx_hash' => ['required', 'string', 'max:255', 'unique:challenge_deposits,stellar_tx_hash'],
        ]);

        $deposit = ChallengeDeposit::create([
            'group_id' => $group->id,
            'user_id' => $request->user()->id,
            'amount' => $data['amount'],
            'stellar_tx_hash' => $data['stellar_tx_hash'],
            'status' => 'pending',
        ]);

        return response()->json($deposit, 201);
    }

    /** The authenticated member's progress toward the target. */
    public function myProgress(Request $request, Group $group): JsonResponse
    {
        $this->assertChallengeMember($request, $group);

        $saved = (float) $group->challengeDeposits()
            ->where('user_id', $request->user()->id)
            ->where('status', 'confirmed')
            ->sum('amount');

        $target = (float) $group->savings_target;
        $percent = $target > 0 ? min(100, round($saved / $target * 100, 2)) : 0;

        return response()->json([
            'group_id' => $group->id,
            'saved' => number_format($saved, 7, '.', ''),
            'target' => number_format($target, 7, '.', ''),
            'percent' => $percent,
            'reached' => $saved >= $target && $target > 0,
            'challenge_ends_at' => $group->challenge_ends_at,
        ]);
    }

    /**
     * Circle summary + leaderboard: the shared target, how the group is doing
     * collectively, and each member's progress (accountability). Respects the
     * group's hide_balances flag by omitting per-member amounts when set.
     */
    public function summary(Request $request, Group $group): JsonResponse
    {
        abort_unless($group->isChallenge(), 404);

        $group->loadCount(['members as member_count' => fn ($q) => $q->where('status', 'approved')]);
        $target = (float) $group->savings_target;

        // Per-member confirmed totals.
        $perMember = $group->challengeDeposits()
            ->where('status', 'confirmed')
            ->selectRaw('user_id, SUM(amount) as saved')
            ->groupBy('user_id')
            ->with('user:id,name')
            ->get();

        $groupSaved = (float) $perMember->sum('saved');
        $reachedCount = $perMember->filter(fn ($r) => $target > 0 && (float) $r->saved >= $target)->count();

        $leaderboard = $group->hide_balances
            ? null
            : $perMember
                ->sortByDesc('saved')
                ->values()
                ->map(fn ($r) => [
                    'user_id' => $r->user_id,
                    'name' => $r->user?->name,
                    'saved' => number_format((float) $r->saved, 7, '.', ''),
                    'percent' => $target > 0 ? min(100, round((float) $r->saved / $target * 100, 2)) : 0,
                ]);

        return response()->json([
            'group' => [
                'id' => $group->id,
                'name' => $group->name,
                'asset_code' => $group->asset_code,
                'savings_target' => number_format($target, 7, '.', ''),
                'challenge_ends_at' => $group->challenge_ends_at,
            ],
            'member_count' => $group->member_count,
            'group_saved_total' => number_format($groupSaved, 7, '.', ''),
            'members_reached_target' => $reachedCount,
            'hide_balances' => (bool) $group->hide_balances,
            'leaderboard' => $leaderboard,
        ]);
    }

    /** Guard: the group must be a challenge and the user an approved member. */
    private function assertChallengeMember(Request $request, Group $group): void
    {
        abort_unless($group->isChallenge(), 404);
        abort_unless(
            $group->members()->where('user_id', $request->user()->id)->where('status', 'approved')->exists(),
            403,
            'Join this challenge before saving to it.'
        );
    }
}
