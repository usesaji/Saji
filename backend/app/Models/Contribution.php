<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

#[Fillable([
    'group_id',
    'user_id',
    'cycle',
    'amount',
    'status',
    'stellar_tx_hash',
    'confirmed_at',
])]
class Contribution extends Model
{
    protected function casts(): array
    {
        return [
            'cycle' => 'integer',
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
