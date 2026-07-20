<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

#[Fillable([
    'name',
    'description',
    'organizer_id',
    'onchain_group_id',
    'contract_address',
    'asset_code',
    'asset_issuer',
    'contribution_amount',
    'cycle_length_days',
    'fee_bps',
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
            'cycle_length_days' => 'integer',
            'fee_bps' => 'integer',
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
