<?php

namespace App\Http\Controllers;

use App\Models\Group;
use App\Models\GroupMember;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Public savings challenges — the OPEN counterpart to closed rotating circles.
 *
 * A challenge is a shared savings goal, not a rotating pool: anyone can browse
 * and join, there is no invite gate, no pooled escrow, no rotation, and no
 * penalties. Each member saves their OWN money (in their own wallet) toward the
 * admin-set target; the circle is accountability + reminders. Non-custodial and
 * entirely off-chain on our side — no contract involvement.
 */
class PublicCircleController extends Controller
{
    /** Browse open public challenges anyone can join. */
    public function index(Request $request): JsonResponse
    {
        $data = $request->validate([
            'q' => ['nullable', 'string', 'max:100'],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:50'],
        ]);

        $circles = Group::query()
            ->where('circle_kind', 'challenge')
            ->whereIn('status', ['open', 'active'])
            ->when($data['q'] ?? null, fn ($qb, $q) => $qb->where('name', 'like', "%{$q}%"))
            ->withCount(['members as member_count' => fn ($q) => $q->where('status', 'approved')])
            ->latest()
            ->paginate($data['per_page'] ?? 20);

        return response()->json($circles);
    }

    /**
     * Create a public savings challenge. Unlike a rotating circle, only a name,
     * a savings target, and (optionally) an end date are needed — no cycle,
     * fees, penalties, or payout order apply.
     */
    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'name' => ['required', 'string', 'max:255'],
            'description' => ['nullable', 'string'],
            'photo_url' => ['nullable', 'string', 'max:2048'],
            'asset_code' => ['nullable', 'string', 'max:12'],
            'savings_target' => ['required', 'numeric', 'min:0.0000001', 'max:1000000000', 'decimal:0,7'],
            'challenge_ends_at' => ['nullable', 'date', 'after:today'],
        ]);

        $user = $request->user();

        $group = Group::create([
            'name' => $data['name'],
            'description' => $data['description'] ?? null,
            'photo_url' => $data['photo_url'] ?? null,
            'organizer_id' => $user->id,
            'asset_code' => $data['asset_code'] ?? 'USDC',
            // Not applicable to a challenge, but the columns are non-null; use
            // harmless defaults so a challenge never carries rotating semantics.
            'contribution_amount' => 0,
            'cycle_length_days' => 1,
            'contribution_frequency' => 'custom',
            'circle_kind' => 'challenge',
            'group_type' => 'public',
            'savings_target' => $data['savings_target'],
            'challenge_ends_at' => $data['challenge_ends_at'] ?? null,
            'auto_approve_join' => true, // open: anyone joins instantly
            'status' => 'open',
        ]);

        // Creator is the first member (approved). No rotation position matters.
        GroupMember::create([
            'group_id' => $group->id,
            'user_id' => $user->id,
            'status' => 'approved',
            'joined_at' => now(),
        ]);

        return response()->json($group->loadCount('members'), 201);
    }

    /** Join a public challenge — open, instant, no invite or approval. */
    public function join(Request $request, Group $group): JsonResponse
    {
        abort_unless($group->isChallenge(), 404);

        $member = GroupMember::firstOrCreate(
            ['group_id' => $group->id, 'user_id' => $request->user()->id],
            ['status' => 'approved', 'joined_at' => now()],
        );

        return response()->json($member, $member->wasRecentlyCreated ? 201 : 200);
    }

    /** Leave a public challenge. (Allowed freely — no rules, no lock.) */
    public function leave(Request $request, Group $group): JsonResponse
    {
        abort_unless($group->isChallenge(), 404);

        // The creator can't abandon their own challenge via leave.
        abort_if($group->organizer_id === $request->user()->id, 422, 'The creator cannot leave their own challenge.');

        $group->members()->where('user_id', $request->user()->id)->delete();

        return response()->json(['message' => 'You left the challenge.']);
    }
}
