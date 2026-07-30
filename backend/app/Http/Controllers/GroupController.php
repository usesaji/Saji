<?php

namespace App\Http\Controllers;

use App\Models\Group;
use App\Models\GroupMember;
use App\Models\Transaction;
use App\Services\Stellar\StellarService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

class GroupController extends Controller
{
    public function __construct(private readonly StellarService $stellar) {}

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
     * Create a savings group (Create Group + Group Rules screens). The
     * organizer is auto-enrolled as member #1. The group starts in 'draft'
     * with no onchain_group_id until the organizer signs create_group; the
     * unsigned XDR for that is returned here.
     */
    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            // Create Group page
            'name' => ['required', 'string', 'max:255'],
            'description' => ['nullable', 'string'],
            'photo_url' => ['nullable', 'string', 'max:2048'],
            'asset_code' => ['nullable', 'string', 'max:12'],
            'contribution_amount' => ['required', 'numeric', 'min:0.0000001'],
            'target_amount' => ['nullable', 'numeric', 'min:0.0000001'],
            'contribution_frequency' => ['required', 'in:daily,weekly,bi_weekly,monthly,custom'],
            // Required only when frequency is custom; otherwise derived below.
            'cycle_length_days' => ['required_if:contribution_frequency,custom', 'integer', 'min:1', 'max:365'],
            // service charge per contribution
            'fee_bps' => ['nullable', 'integer', 'min:0', 'max:10000'],

            // Group Rules page
            'late_fee_bps' => ['nullable', 'integer', 'min:0', 'max:10000'],
            'grace_period_hours' => ['nullable', 'integer', 'min:0', 'max:8760'],
            'late_penalty' => ['nullable', 'in:deduct_from_balance,remove_member'],
            'payout_order' => ['nullable', 'in:random,manual,vote,custom'],
            'group_type' => ['nullable', 'in:public,private'],
            'auto_approve_join' => ['nullable', 'boolean'],
            'hide_balances' => ['nullable', 'boolean'],
        ]);

        $user = $request->user();

        $cycleLengthDays = $this->cycleLengthFromFrequency(
            $data['contribution_frequency'],
            $data['cycle_length_days'] ?? null,
        );

        $group = Group::create([
            'name' => $data['name'],
            'description' => $data['description'] ?? null,
            'photo_url' => $data['photo_url'] ?? null,
            'organizer_id' => $user->id,
            'asset_code' => $data['asset_code'] ?? 'USDC',
            'contribution_amount' => $data['contribution_amount'],
            'target_amount' => $data['target_amount'] ?? null,
            'cycle_length_days' => $cycleLengthDays,
            'contribution_frequency' => $data['contribution_frequency'],
            'fee_bps' => $data['fee_bps'] ?? 0,
            'late_fee_bps' => $data['late_fee_bps'] ?? 0,
            'grace_period_hours' => $data['grace_period_hours'] ?? 0,
            'late_penalty' => $data['late_penalty'] ?? 'deduct_from_balance',
            'payout_order' => $data['payout_order'] ?? 'manual',
            'group_type' => $data['group_type'] ?? 'private',
            'auto_approve_join' => $data['auto_approve_join'] ?? false,
            'hide_balances' => $data['hide_balances'] ?? false,
            'invite_token' => Str::random(40),
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

        // Non-custodial: we cannot create the group on-chain ourselves — the
        // organizer's wallet must sign. Build the unsigned create_group tx and
        // hand it back for the frontend to sign + submit (see submitOnchain()).
        // Requires both a linked wallet AND a resolvable token address; without
        // a token we'd emit a tx that fails opaquely, so skip and return null.
        $unsignedXdr = null;
        $token = $group->asset_issuer ?: config('services.stellar.usdc_sac');
        if ($user->stellar_address && $token) {
            $unsignedXdr = $this->stellar->buildCreateGroupTx(
                organizer: $user->stellar_address,
                token: $token,
                amount: $this->toStroops($group->contribution_amount),
                cycleLength: $group->cycle_length_days * 86_400,
                feeBps: $group->fee_bps,
                lateFeeBps: $group->late_fee_bps,
                gracePeriod: $group->grace_period_hours * 3_600,
                payoutOrder: $this->payoutOrderVariant($group->payout_order),
                latePenalty: $this->latePenaltyVariant($group->late_penalty),
            );
        }

        return response()->json([
            'group' => $group->loadCount('members'),
            'unsigned_xdr' => $unsignedXdr,
        ], 201);
    }

    /**
     * Create Group photo: upload/replace the group's picture. Organizer-only,
     * mirrors the profile-avatar flow (stored on the public disk, URL saved).
     */
    public function uploadPhoto(Request $request, Group $group): JsonResponse
    {
        abort_unless($group->organizer_id === $request->user()->id, 403, 'Only the organizer can change the group photo.');

        $request->validate([
            'photo' => ['required', 'image', 'mimes:jpeg,jpg,png,webp', 'max:5120'], // 5 MB
        ]);

        // Replace any previously uploaded photo (skip external URLs).
        if ($group->photo_url && str_starts_with($group->photo_url, '/storage/')) {
            $old = str_replace('/storage/', '', $group->photo_url);
            Storage::disk('public')->delete($old);
        }

        $path = $request->file('photo')->store('group-photos', 'public');
        $url = '/storage/'.$path;

        $group->update(['photo_url' => $url]);

        return response()->json(['photo_url' => $url]);
    }

    /** A single group with its members. */
    public function show(Group $group): JsonResponse
    {
        return response()->json(
            $group->load(['organizer:id,name', 'members.user:id,name,stellar_address'])
                ->loadCount('members')
        );
    }

    /**
     * Circle deposit page: everything needed to make this cycle's contribution
     * — the user's live wallet balance and the fixed amount to contribute. The
     * deposit itself is the ordinary contribute flow (POST .../contributions).
     */
    public function depositPage(Request $request, Group $group): JsonResponse
    {
        $user = $request->user();

        abort_unless(
            $group->members()->where('user_id', $user->id)->where('status', 'approved')->exists(),
            403,
            'You are not an approved member of this group.'
        );

        // Live wallet balance (non-custodial read), when a wallet is linked.
        $walletBalance = null;
        if ($user->stellar_address) {
            $token = $group->asset_issuer ?: config('services.stellar.usdc_sac');
            if ($token) {
                $stroops = $this->stellar->balanceOf($user->stellar_address, $token);
                $walletBalance = number_format($stroops / 10_000_000, 7, '.', '');
            }
        }

        $alreadyPaid = $group->contributions()
            ->where('user_id', $user->id)
            ->where('cycle', $group->current_cycle)
            ->whereIn('status', ['pending', 'confirmed'])
            ->exists();

        return response()->json([
            'group_id' => $group->id,
            'group_name' => $group->name,
            'asset_code' => $group->asset_code,
            'amount_to_contribute' => $group->contribution_amount,
            'current_cycle' => $group->current_cycle,
            'wallet_balance' => $walletBalance,
            'wallet_linked' => (bool) $user->stellar_address,
            'already_contributed_this_cycle' => $alreadyPaid,
            'contribute_endpoint' => "/api/groups/{$group->id}/contributions",
        ]);
    }

    /**
     * The Circle/Group page: group-level totals, the user's own progress toward
     * the target, a circle progress bar, the payout rotation, and cycle
     * activity. All figures are the off-chain index of on-chain state.
     */
    public function circle(Request $request, Group $group): JsonResponse
    {
        $user = $request->user();
        $group->loadCount(['members as member_count' => fn ($q) => $q->where('status', 'approved')]);

        // Total deposited by the whole group (confirmed contributions).
        $totalDeposited = (float) $group->contributions()->where('status', 'confirmed')->sum('amount');

        // This user's own totals + aim. In a rotating circle the "aim" is one
        // full payout (the pooled amount they eventually receive): amount ×
        // member_count. Progress is what they've paid in so far toward that.
        $userPaid = (float) $group->contributions()
            ->where('user_id', $user->id)
            ->where('status', 'confirmed')
            ->sum('amount');
        $userAim = (float) $group->contribution_amount * max($group->member_count, 1);
        $userProgressPct = $userAim > 0 ? min(100, round($userPaid / $userAim * 100, 2)) : 0;

        // Circle progress: cycles completed out of the full rotation.
        $totalCycles = max($group->member_count, 1);
        $circleProgressPct = round(min($group->current_cycle, $totalCycles) / $totalCycles * 100, 2);

        // Payout rotation: members in payout order with who's already received.
        $rotation = $group->members()
            ->where('status', 'approved')
            ->with('user:id,name,stellar_address')
            ->orderBy('payout_position')
            ->get()
            ->map(fn ($m) => [
                'position' => $m->payout_position,
                'user_id' => $m->user_id,
                'name' => $m->user?->name,
                'has_received_payout' => (bool) $m->has_received_payout,
            ]);

        // Cycle activity: recent on-chain events for this group.
        $cycleActivity = $group->transactions()
            ->latest()
            ->limit(20)
            ->get(['id', 'type', 'status', 'stellar_tx_hash', 'explorer_url', 'created_at']);

        return response()->json([
            'group' => [
                'id' => $group->id,
                'name' => $group->name,
                'status' => $group->status,
                'asset_code' => $group->asset_code,
                'contribution_amount' => $group->contribution_amount,
                'target_amount' => $group->target_amount,
                'contract_address' => $group->contract_address,
            ],
            'member_count' => $group->member_count,
            'current_cycle' => $group->current_cycle,
            'total_deposited' => number_format($totalDeposited, 7, '.', ''),
            'user_progress' => [
                'paid' => number_format($userPaid, 7, '.', ''),
                'aim' => number_format($userAim, 7, '.', ''),
                'percent' => $userProgressPct,
            ],
            'circle_progress' => [
                'cycles_done' => min($group->current_cycle, $totalCycles),
                'cycles_total' => $totalCycles,
                'percent' => $circleProgressPct,
            ],
            'payout_rotation' => $rotation,
            'cycle_activity' => $cycleActivity,
        ]);
    }

    /**
     * Join Group page preview — what a prospective member sees before joining:
     * the goal, current member count, and the group's settings/rules. Public
     * fields only (no member PII), so it's safe to show via an invite link.
     */
    public function joinPreview(Request $request, string $token): JsonResponse
    {
        $group = Group::where('invite_token', $token)
            ->withCount(['members as member_count' => fn ($q) => $q->where('status', 'approved')])
            ->firstOrFail();

        return response()->json([
            'id' => $group->id,
            'name' => $group->name,
            'description' => $group->description,
            'photo_url' => $group->photo_url,
            'target_amount' => $group->target_amount,
            'member_count' => $group->member_count,
            'settings' => [
                'group_type' => $group->group_type,
                'payout_order' => $group->payout_order,
                'contribution_amount' => $group->contribution_amount,
                'contribution_frequency' => $group->contribution_frequency,
                'fee_bps' => $group->fee_bps,
                'late_fee_bps' => $group->late_fee_bps,
                'grace_period_hours' => $group->grace_period_hours,
                'late_penalty' => $group->late_penalty,
                'auto_approve_join' => $group->auto_approve_join,
            ],
        ]);
    }

    /**
     * The Invite Link page: the organizer fetches the shareable join link.
     * Backed by the group's unguessable invite_token.
     */
    public function inviteLink(Request $request, Group $group): JsonResponse
    {
        abort_unless($group->organizer_id === $request->user()->id, 403, 'Only the organizer can view the invite link.');

        // Lazily mint a token for groups created before this feature existed.
        if (! $group->invite_token) {
            $group->update(['invite_token' => Str::random(40)]);
        }

        $frontend = Str::of((string) config('app.frontend_url'))->before(',')->rtrim('/');

        return response()->json([
            'invite_token' => $group->invite_token,
            'invite_url' => $frontend->isNotEmpty()
                ? "{$frontend}/groups/join/{$group->invite_token}"
                : null,
        ]);
    }

    /**
     * Join a group — ONLY via its invite link/token. There is no join-by-id
     * path: a user must have the unguessable invite token to enter a circle.
     *
     * Honors the group rule: when auto_approve_join is on, the member is
     * admitted immediately (given a rotation position); otherwise they wait as
     * 'pending' for the organizer to accept them.
     */
    public function joinByToken(Request $request, string $token): JsonResponse
    {
        $group = Group::where('invite_token', $token)->firstOrFail();
        $userId = $request->user()->id;

        if ($group->auto_approve_join) {
            $nextPosition = (int) $group->members()->max('payout_position') + 1;

            $member = GroupMember::firstOrCreate(
                ['group_id' => $group->id, 'user_id' => $userId],
                ['status' => 'approved', 'payout_position' => $nextPosition, 'joined_at' => now()],
            );
        } else {
            $member = GroupMember::firstOrCreate(
                ['group_id' => $group->id, 'user_id' => $userId],
                ['status' => 'pending'],
            );
        }

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

        // Non-custodial: admitting a member on-chain is authorized by the
        // ORGANIZER's wallet. Build the unsigned join_group tx for the organizer
        // (this request's user) to sign + submit via submitOnchain().
        $unsignedXdr = null;
        $organizer = $request->user();
        if ($organizer->stellar_address && $group->onchain_group_id !== null && $member->user->stellar_address) {
            $unsignedXdr = $this->stellar->buildJoinGroupTx(
                organizer: $organizer->stellar_address,
                groupId: $group->onchain_group_id,
                member: $member->user->stellar_address,
            );
        }

        return response()->json([
            'member' => $member,
            'unsigned_xdr' => $unsignedXdr,
        ]);
    }

    /**
     * Drag-and-drop "who gets paid first". The organizer submits the desired
     * order of member ids; we set each member's payout_position off-chain and,
     * for a Manual-order group still forming, return the unsigned
     * set_payout_order tx that freezes that order on-chain at start_cycle.
     *
     * The submitted list must be exactly the group's approved members — same
     * set, no omissions or extras — so a reorder can never add or drop anyone.
     */
    public function setPayoutOrder(Request $request, Group $group): JsonResponse
    {
        abort_if($group->isChallenge(), 422, 'A savings challenge has no payout rotation.');
        abort_unless($group->organizer_id === $request->user()->id, 403, 'Only the organizer can set the payout order.');
        abort_unless(in_array($group->status, ['draft', 'open'], true), 422, 'The payout order can only be changed before the cycle starts.');

        $data = $request->validate([
            'member_ids' => ['required', 'array', 'min:2'],
            'member_ids.*' => ['integer'],
        ]);

        $approved = $group->members()->where('status', 'approved')->pluck('user_id');

        // The submitted order must be a permutation of the approved members.
        $submitted = collect($data['member_ids']);
        if ($submitted->count() !== $approved->count()
            || $submitted->unique()->count() !== $submitted->count()
            || $submitted->diff($approved)->isNotEmpty()) {
            abort(422, 'The order must list each approved member exactly once.');
        }

        // Persist positions 1..n in the submitted order.
        foreach ($submitted->values() as $index => $userId) {
            $group->members()->where('user_id', $userId)->update(['payout_position' => $index + 1]);
        }

        // Build the on-chain reorder for a Manual group that is live on-chain.
        $unsignedXdr = null;
        $organizer = $request->user();
        if ($group->payout_order === 'manual'
            && $organizer->stellar_address
            && $group->onchain_group_id !== null) {
            // Translate the ordered user ids to their Stellar addresses.
            $addresses = $group->members()
                ->whereIn('user_id', $submitted->all())
                ->with('user:id,stellar_address')
                ->get()
                ->sortBy('payout_position')
                ->map(fn ($m) => $m->user->stellar_address)
                ->filter()
                ->values();

            // Only build if every member has a linked wallet (else the on-chain
            // permutation would be incomplete and rejected).
            if ($addresses->count() === $submitted->count()) {
                $unsignedXdr = $this->stellar->buildSetPayoutOrderTx(
                    organizer: $organizer->stellar_address,
                    groupId: $group->onchain_group_id,
                    order: $addresses->all(),
                );
            }
        }

        return response()->json([
            'members' => $group->members()->with('user:id,name')->orderBy('payout_position')->get(),
            'unsigned_xdr' => $unsignedXdr,
        ]);
    }

    /**
     * Broadcast a wallet-signed transaction envelope and record it. This is the
     * second half of every non-custodial money action: the frontend posts back
     * the XDR its wallet signed, we submit it to Soroban and log the tx.
     *
     * The chain indexer (poller) is what ultimately flips domain rows to
     * confirmed from the emitted events; this endpoint just gets the signed tx
     * on-chain and gives the frontend a hash + explorer link immediately.
     */
    public function submitOnchain(Request $request, Group $group): JsonResponse
    {
        $data = $request->validate([
            'signed_xdr' => ['required', 'string'],
            'type' => ['required', 'in:create_group,join,contribution,payout'],
        ]);

        // Only someone tied to this group may broadcast a tx against it and log
        // a row under it: the organizer, or an approved member. Without this
        // check any authenticated user could attribute arbitrary transactions
        // to any group.
        $user = $request->user();
        $isOrganizer = $group->organizer_id === $user->id;
        $isMember = $group->members()
            ->where('user_id', $user->id)
            ->where('status', 'approved')
            ->exists();

        abort_unless($isOrganizer || $isMember, 403, 'You are not a member of this group.');

        $result = $this->stellar->submitSigned($data['signed_xdr']);

        $tx = Transaction::create([
            'group_id' => $group->id,
            'user_id' => $request->user()->id,
            'type' => $data['type'],
            'stellar_tx_hash' => $result['hash'],
            'status' => $result['status'] === 'SUCCESS' ? 'success' : 'pending',
            'explorer_url' => $this->stellar->explorerUrl($result['hash']),
        ]);

        return response()->json($tx, 201);
    }

    /** Convert a 7-dp decimal token amount (e.g. "5.0000000") to i128 stroops. */
    private function toStroops(string|float $amount): int
    {
        return (int) round((float) $amount * 10_000_000);
    }

    /**
     * Map a stored payout_order value to the exact Soroban `PayoutOrder` enum
     * variant name the contract expects. Falls back to Manual for anything
     * unrecognised so we never pass an invalid variant to the CLI.
     */
    private function payoutOrderVariant(?string $order): string
    {
        return match ($order) {
            'random' => 'Random',
            'vote' => 'Vote',
            'custom' => 'Custom',
            default => 'Manual',
        };
    }

    /** Map a stored late_penalty value to the Soroban `LatePenalty` variant. */
    private function latePenaltyVariant(?string $penalty): string
    {
        return match ($penalty) {
            'remove_member' => 'RemoveMember',
            default => 'DeductFromBalance',
        };
    }

    /**
     * Map a contribution frequency to a cycle length in days. 'custom' keeps
     * the caller-supplied value; the others are fixed cadences.
     */
    private function cycleLengthFromFrequency(string $frequency, ?int $customDays): int
    {
        return match ($frequency) {
            'daily' => 1,
            'weekly' => 7,
            'bi_weekly' => 14,
            'monthly' => 30,
            'custom' => $customDays ?? 7,
        };
    }
}
