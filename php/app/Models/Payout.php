<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

#[Fillable([
    'group_id',
    'recipient_id',
    'cycle',
    'gross_amount',
    'fee_amount',
    'net_amount',
    'status',
    'stellar_tx_hash',
    'confirmed_at',
])]
class Payout extends Model
{
    protected function casts(): array
    {
        return [
            'cycle' => 'integer',
            'gross_amount' => 'decimal:7',
            'fee_amount' => 'decimal:7',
            'net_amount' => 'decimal:7',
            'confirmed_at' => 'datetime',
        ];
    }

    public function group(): BelongsTo
    {
        return $this->belongsTo(Group::class);
    }

    public function recipient(): BelongsTo
    {
        return $this->belongsTo(User::class, 'recipient_id');
    }
}
