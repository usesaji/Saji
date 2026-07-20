<?php

namespace App\Http\Controllers;

use App\Models\Group;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Aggregated, read-optimized view of a group's health for the dashboard.
 * The brief's UX goal: a member understands group health within 5 seconds.
 *
 * Balances shown here are the off-chain INDEX. The response also returns the
 * contract address so the frontend can link to on-chain verification — the
 * chain remains the source of truth.
 */
class DashboardController extends Controller
{
    public function show(Request $request, Group $group): JsonResponse
    {
        $group->loadCount([
            'members as member_count' => fn ($q) => $q->where('status', 'approved'),
        ]);

        $confirmedThisCycle = $group->contributions()
            ->where('cycle', $group->current_cycle)
            ->where('status', 'confirmed')
            ->count();

        // Pool = confirmed contributions not yet paid out. Mirror of on-chain.
        $poolBalance = $group->contributions()->where('status', 'confirmed')->sum('amount')
            - $group->payouts()->where('status', 'confirmed')->sum('net_amount')
            - $group->payouts()->where('status', 'confirmed')->sum('fee_amount');

        $recentActivity = $group->transactions()
            ->latest()
            ->limit(10)
            ->get(['id', 'type', 'status', 'stellar_tx_hash', 'explorer_url', 'created_at']);

        return response()->json([
            'group' => [
                'id' => $group->id,
                'name' => $group->name,
                'status' => $group->status,
                'asset_code' => $group->asset_code,
                'contribution_amount' => $group->contribution_amount,
                'contract_address' => $group->contract_address,
            ],
            'member_count' => $group->member_count,
            'current_cycle' => $group->current_cycle,
            'pool_balance' => number_format((float) $poolBalance, 7, '.', ''),
            'next_recipient_id' => $group->next_recipient_id,
            'next_payout_at' => $group->next_payout_at,
            'contribution_progress' => [
                'confirmed' => $confirmedThisCycle,
                'total_members' => $group->member_count,
            ],
            'recent_activity' => $recentActivity,
        ]);
    }
}
