<?php

namespace App\Http\Controllers;

use App\Models\Group;
use App\Models\GroupMember;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * The user's HOME dashboard (distinct from the per-group DashboardController).
 *
 * Backs the dashboard screen: a headline "saved balance", a quick-deposit
 * target, and the user's current saving circles with a "view all" affordance.
 *
 * Every figure here is the off-chain INDEX mirrored from Soroban. The chain is
 * the source of truth; these are read-optimized aggregates for a fast render.
 */
class UserDashboardController extends Controller
{
    public function show(Request $request): JsonResponse
    {
        $user = $request->user();

        // Groups the user belongs to as an APPROVED member (their active circles).
        $memberGroupIds = GroupMember::query()
            ->where('user_id', $user->id)
            ->where('status', 'approved')
            ->pluck('group_id');

        // Saved balance: what the user has contributed and confirmed on-chain,
        // less what has already rotated back to them as payouts. In a thrift
        // circle this is the value they currently have "in play" across groups.
        $contributed = (float) $user->contributions()
            ->where('status', 'confirmed')
            ->sum('amount');

        $received = (float) $user->payouts()
            ->where('status', 'confirmed')
            ->sum('net_amount');

        $savedBalance = $contributed - $received;

        // Current circles: active/open groups the user is in, newest first, with
        // just enough for a card. "View all" on the frontend pages the rest.
        $circles = Group::query()
            ->whereIn('id', $memberGroupIds)
            ->whereIn('status', ['open', 'active'])
            ->withCount([
                'members as member_count' => fn ($q) => $q->where('status', 'approved'),
            ])
            ->latest()
            ->limit(5)
            ->get()
            ->map(fn (Group $g) => $this->circleCard($g, $user->id));

        $totalCircles = Group::query()
            ->whereIn('id', $memberGroupIds)
            ->whereIn('status', ['open', 'active'])
            ->count();

        // Quick deposit: the most pressing contribution the user owes right now,
        // so the dashboard button can jump straight to it. Null when nothing due.
        $quickDeposit = $this->nextDue($memberGroupIds, $user->id);

        return response()->json([
            'saved_balance' => number_format($savedBalance, 7, '.', ''),
            'asset_code' => 'USDC',
            'circles' => $circles,
            'circles_total' => $totalCircles,
            'has_more_circles' => $totalCircles > $circles->count(),
            'quick_deposit' => $quickDeposit,
        ]);
    }

    /** Compact per-circle summary for a dashboard card. */
    private function circleCard(Group $group, int $userId): array
    {
        $paidThisCycle = $group->contributions()
            ->where('user_id', $userId)
            ->where('cycle', $group->current_cycle)
            ->whereIn('status', ['pending', 'confirmed'])
            ->exists();

        return [
            'id' => $group->id,
            'name' => $group->name,
            'status' => $group->status,
            'asset_code' => $group->asset_code,
            'contribution_amount' => $group->contribution_amount,
            'member_count' => $group->member_count,
            'current_cycle' => $group->current_cycle,
            'contributed_this_cycle' => $paidThisCycle,
        ];
    }

    /**
     * The soonest contribution the user still owes across their active groups.
     * Drives the "quick deposit" shortcut. Returns null when all caught up.
     */
    private function nextDue($groupIds, int $userId): ?array
    {
        $due = Group::query()
            ->whereIn('id', $groupIds)
            ->where('status', 'active')
            ->whereDoesntHave('contributions', fn ($q) => $q
                ->where('user_id', $userId)
                ->whereColumn('cycle', 'groups.current_cycle')
                ->whereIn('status', ['pending', 'confirmed'])
            )
            ->orderBy('next_payout_at')
            ->first();

        if (! $due) {
            return null;
        }

        return [
            'group_id' => $due->id,
            'group_name' => $due->name,
            'amount' => $due->contribution_amount,
            'asset_code' => $due->asset_code,
            'cycle' => $due->current_cycle,
            'due_at' => $due->next_payout_at,
        ];
    }
}
