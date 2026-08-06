<?php

namespace App\Http\Controllers;

use App\Models\Contribution;
use App\Models\Group;
use App\Models\GroupMember;
use App\Models\Payout;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

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
        //
        // Grouped PER ASSET. A circle saves in exactly one token (XLM/USDC/USDT)
        // chosen at creation, so a user in three circles can hold three
        // different currencies. Summing them into one figure would add
        // unrelated units and label the total as whichever asset we guessed —
        // and subtracting a USDT payout from an XLM contribution can even go
        // negative. `assets` is the truthful breakdown; `saved_balance` /
        // `asset_code` below stay as the LARGEST single asset so older screens
        // keep rendering something meaningful.
        $assets = $this->savedPerAsset($user->id);

        // Headline = the asset the user has most in play. Falls back to USDC
        // (the default circle currency) when there is nothing saved at all.
        $headline = $assets[0] ?? ['asset_code' => 'USDC', 'saved' => '0.0000000'];

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

        // Distinct people the user saves with, across ALL their circles and
        // excluding themselves — so a solo circle reads "+0 People" honestly
        // and someone in two overlapping circles isn't counted twice.
        $peopleTotal = GroupMember::query()
            ->whereIn('group_id', $memberGroupIds)
            ->where('status', 'approved')
            ->where('user_id', '!=', $user->id)
            ->distinct()
            ->count('user_id');

        // Quick deposit: the most pressing contribution the user owes right now,
        // so the dashboard button can jump straight to it. Null when nothing due.
        $quickDeposit = $this->nextDue($memberGroupIds, $user->id);

        return response()->json([
            // Largest single asset — a real figure in a real currency, never a
            // cross-currency sum. Use `assets` for the full picture.
            'saved_balance' => $headline['saved'],
            'asset_code' => $headline['asset_code'],
            // Every asset the user has money in play in, largest first.
            'assets' => $assets,
            // Members across ALL the user's circles, not just the 5 listed
            // below — the dashboard shows a headline count, and capping it at
            // the page size would under-report it.
            'people_total' => $peopleTotal,
            'circles' => $circles,
            'circles_total' => $totalCircles,
            'has_more_circles' => $totalCircles > $circles->count(),
            'quick_deposit' => $quickDeposit,
        ]);
    }

    /**
     * Money still in play per asset: confirmed contributions less confirmed
     * payouts, grouped by the circle's asset. Largest first, zero/negative
     * entries dropped.
     *
     * Neither `contributions` nor `payouts` stores an asset — a circle saves in
     * one token, so the asset lives on the parent group and both sides have to
     * join through it.
     *
     * @return list<array{asset_code:string, saved:string}>
     */
    private function savedPerAsset(int $userId): array
    {
        // `pluck` cannot take a raw aggregate as its value column — it would be
        // read as a literal column name — so the sum is selected under an alias
        // and plucked by that.
        $contributed = Contribution::query()
            ->join('groups', 'groups.id', '=', 'contributions.group_id')
            ->where('contributions.user_id', $userId)
            ->where('contributions.status', 'confirmed')
            ->groupBy('groups.asset_code')
            ->select('groups.asset_code', DB::raw('SUM(contributions.amount) as total'))
            ->pluck('total', 'asset_code');

        $received = Payout::query()
            ->join('groups', 'groups.id', '=', 'payouts.group_id')
            ->where('payouts.recipient_id', $userId)
            ->where('payouts.status', 'confirmed')
            ->groupBy('groups.asset_code')
            ->select('groups.asset_code', DB::raw('SUM(payouts.net_amount) as total'))
            ->pluck('total', 'asset_code');

        $codes = $contributed->keys()->merge($received->keys())->unique();

        return $codes
            ->map(fn (string $code) => [
                'asset_code' => $code,
                'net' => (float) ($contributed[$code] ?? 0) - (float) ($received[$code] ?? 0),
            ])
            // A fully-rotated circle nets to zero, and rounding can leave a
            // negative dust figure; neither is worth a row on the dashboard.
            ->filter(fn (array $a) => $a['net'] > 0)
            ->sortByDesc('net')
            ->map(fn (array $a) => [
                'asset_code' => $a['asset_code'],
                'saved' => number_format($a['net'], 7, '.', ''),
            ])
            ->values()
            ->all();
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

        // Quick deposit IS the ordinary contribution for the soonest-due circle
        // — same amount, same cycle, same endpoint. We surface the exact
        // contribute endpoint so the dashboard button drives the normal flow
        // (POST there returns the unsigned contribute XDR to sign) rather than
        // any separate deposit mechanism.
        return [
            'group_id' => $due->id,
            'group_name' => $due->name,
            'amount' => $due->contribution_amount,
            'asset_code' => $due->asset_code,
            'cycle' => $due->current_cycle,
            'due_at' => $due->next_payout_at,
            'contribute_endpoint' => "/api/groups/{$due->id}/contributions",
        ];
    }
}
