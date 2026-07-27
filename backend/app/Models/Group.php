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
    'payout_order',
    'auto_approve_join',
    'hide_balances',
    'invite_token',
    'status',
    'current_cycle',
    'next_recipient_id',
    'next_payout_at',
])]
class Group extends Model
{
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
}
