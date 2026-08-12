<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * A member's save toward a public savings-challenge target. Non-custodial —
 * the funds live in the member's own wallet; this just records verifiable
 * progress. No pool, no rotation.
 */
#[Fillable([
    'group_id',
    'user_id',
    'amount',
    'stellar_tx_hash',
    'status',
    'confirmed_at',
])]
class ChallengeDeposit extends Model
{
    protected function casts(): array
    {
        return [
            'amount' => 'decimal:7',
            'confirmed_at' => 'datetime',
        ];
    }

    public function group(): BelongsTo
    {
        return $this->belongsTo(Group::class);
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
