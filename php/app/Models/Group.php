<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

#[Fillable([
    'name',
    'description',
    'photo_url',
    'organizer_id',
    'onchain_group_id',
    'contract_address',
    'asset_code',
    'asset_issuer',
    'contribution_amount',
    'target_amount',
    'cycle_length_days',
    'contribution_frequency',
    'fee_bps',
    'late_fee_bps',
    'grace_period_hours',
    'late_penalty',
    'payout_order',
    'group_type',
    'auto_approve_join',
    'hide_balances',
    'invite_token',
    'status',
    'circle_kind',
    'savings_target',
    'challenge_ends_at',
    'current_cycle',
    'next_recipient_id',
    'next_payout_at',
])]
class Group extends Model
{
    /**
     * `invite_token` is the sole gate on joining a private circle, so it must
     * never ride along in a serialized group. The organizer fetches it from the
     * dedicated invite-link endpoint instead.
     */
    protected $hidden = ['invite_token'];

    protected function casts(): array
    {
        return [
            'contribution_amount' => 'decimal:7',
            'target_amount' => 'decimal:7',
            'cycle_length_days' => 'integer',
            'fee_bps' => 'integer',
            'late_fee_bps' => 'integer',
            'grace_period_hours' => 'integer',
            'auto_approve_join' => 'boolean',
            'hide_balances' => 'boolean',
            'savings_target' => 'decimal:7',
            'challenge_ends_at' => 'datetime',
            'current_cycle' => 'integer',
            'onchain_group_id' => 'integer',
            'next_payout_at' => 'datetime',
        ];
    }

    public function organizer(): BelongsTo
    {
        return $this->belongsTo(User::class, 'organizer_id');
    }

    public function nextRecipient(): BelongsTo
    {
        return $this->belongsTo(User::class, 'next_recipient_id');
    }

    public function members(): HasMany
    {
        return $this->hasMany(GroupMember::class);
    }

    public function contributions(): HasMany
    {
        return $this->hasMany(Contribution::class);
    }

    public function payouts(): HasMany
    {
        return $this->hasMany(Payout::class);
    }

    public function transactions(): HasMany
    {
        return $this->hasMany(Transaction::class);
    }

    /** Saves toward the target (public challenge circles only). */
    public function challengeDeposits(): HasMany
    {
        return $this->hasMany(ChallengeDeposit::class);
    }

    /** True for a public savings challenge (no pool/rotation). */
    public function isChallenge(): bool
    {
        return $this->circle_kind === 'challenge';
    }

    /**
     * Can this user see the group's private detail — finances, member roster
     * (names + Stellar addresses), and the invite token?
     *
     * The organizer plus anyone with a live membership. Pending requesters are
     * deliberately included: they need to see what they asked to join. Declined
     * or removed members are not.
     *
     * Public challenge circles are discoverable by design, so they stay open.
     */
    public function isVisibleTo(?User $user): bool
    {
        if (! $user) {
            return false;
        }
        if ($this->isChallenge() || $this->group_type === 'public') {
            return true;
        }
        if ($this->organizer_id === $user->id) {
            return true;
        }

        return $this->members()
            ->where('user_id', $user->id)
            ->whereIn('status', ['approved', 'pending'])
            ->exists();
    }

    /**
     * The Stellar Asset Contract address for this group's pool token.
     *
     * Resolution order: an explicit per-group asset_issuer, then the configured
     * SAC for the group's asset_code (USDC/USDT/XLM), then the USDC default.
     * Without the asset_code lookup an XLM or USDT group would silently get the
     * USDC SAC — the wrong asset entirely.
     */
    public function tokenSac(): ?string
    {
        if ($this->asset_issuer) {
            return $this->asset_issuer;
        }

        $sacs = (array) config('services.stellar.token_sacs', []);

        return $sacs[$this->asset_code] ?? config('services.stellar.usdc_sac');
    }
}
