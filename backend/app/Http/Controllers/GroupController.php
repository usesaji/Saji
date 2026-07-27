<?php

namespace App\Http\Controllers;

use App\Models\Group;
use App\Models\GroupMember;
use App\Models\Transaction;
use App\Services\Stellar\StellarService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
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
            'payout_order' => ['nullable', 'in:random,manual,vote,custom'],
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
            'payout_order' => $data['payout_order'] ?? 'manual',
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
            );
        }

        return response()->json([
            'group' => $group->loadCount('members'),
            'unsigned_xdr' => $unsignedXdr,
        ], 201);
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
     * Request to join a group. Honors the group rule: when auto_approve_join is
     * on, the member is admitted immediately (and given a rotation position);
     * otherwise they wait as 'pending' for organizer approval.
     */
    public function join(Request $request, Group $group): JsonResponse
    {
        return $this->admitMember($group, $request->user()->id);
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
     * Join a group via its invite token (Invite Link flow). Same admission
     * rules as join(): auto-approved or pending per the group's setting.
     */
    public function joinByToken(Request $request, string $token): JsonResponse
    {
        $group = Group::where('invite_token', $token)->firstOrFail();

        return $this->admitMember($group, $request->user()->id);
    }

    /** Shared admission logic for join() and joinByToken(). */
    private function admitMember(Group $group, int $userId): JsonResponse
    {
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
