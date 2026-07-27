<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * A user's payout destination (the "Withdraw Info" screen). Public address
 * only — Saji never holds a secret key.
 */
#[Fillable([
    'user_id',
    'stellar_address',
    'memo',
    'memo_type',
    'destination_label',
])]
class WithdrawInfo extends Model
{
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
