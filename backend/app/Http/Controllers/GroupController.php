<?php

namespace App\Http\Controllers;

use App\Models\Group;
use App\Models\GroupMember;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class GroupController extends Controller
{
    /** Groups the authenticated user organizes or belongs to. */
    public function index(Request $request): JsonResponse
    {
        $userId = $request->user()->id;

        $groups = Group::query()
            ->where('organizer_id', $userId)
            ->orWhereHas('members', fn ($q) => $q->where('user_id', $userId))
            ->withCount('members')
            ->latest()
            ->get();

        return response()->json($groups);
    }

    /**
     * Create a savings group. The organizer is auto-enrolled as the first
     * member. The on-chain create_group call happens in a later milestone;
     * for now the group is created in 'draft' with no onchain_group_id yet.
     */
    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'name' => ['required', 'string', 'max:255'],
            'description' => ['nullable', 'string'],
            'asset_code' => ['nullable', 'string', 'max:12'],
            'contribution_amount' => ['required', 'numeric', 'min:0.0000001'],
            'cycle_length_days' => ['required', 'integer', 'min:1', 'max:365'],
            'fee_bps' => ['nullable', 'integer', 'min:0', 'max:10000'], // 0%..100%
        ]);

        $user = $request->user();

        $group = Group::create([
            'name' => $data['name'],
            'description' => $data['description'] ?? null,
            'organizer_id' => $user->id,
            'asset_code' => $data['asset_code'] ?? 'USDC',
            'contribution_amount' => $data['contribution_amount'],
            'cycle_length_days' => $data['cycle_length_days'],
            'fee_bps' => $data['fee_bps'] ?? 0,
            'status' => 'draft',
        ]);

        // Organizer is member #1 and pre-approved.
        GroupMember::create([
            'group_id' => $group->id,
            'user_id' => $user->id,
            'status' => 'approved',
            'payout_position' => 1,
            'joined_at' => now(),
        ]);

        // TODO(M1): StellarService::createGroup() -> set onchain_group_id + contract_address.

        return response()->json($group->loadCount('members'), 201);
    }

    /** A single group with its members. */
    public function show(Group $group): JsonResponse
    {
        return response()->json(
            $group->load(['organizer:id,name', 'members.user:id,name,stellar_address'])
                ->loadCount('members')
        );
    }

    /** Request to join a group (private cycles => 'pending' until approved). */
    public function join(Request $request, Group $group): JsonResponse
    {
        $member = GroupMember::firstOrCreate(
            ['group_id' => $group->id, 'user_id' => $request->user()->id],
            ['status' => 'pending']
        );

        return response()->json($member, $member->wasRecentlyCreated ? 201 : 200);
    }

    /** Organizer approves a pending member and fixes their rotation position. */
    public function approve(Request $request, Group $group, GroupMember $member): JsonResponse
    {
        abort_unless($group->organizer_id === $request->user()->id, 403, 'Only the organizer can approve members.');
        abort_unless($member->group_id === $group->id, 404);

        $nextPosition = (int) $group->members()->max('payout_position') + 1;

        $member->update([
            'status' => 'approved',
            'payout_position' => $nextPosition,
            'joined_at' => now(),
        ]);

        // TODO(M1): StellarService::joinGroup() to admit the member on-chain.

        return response()->json($member);
    }
}
