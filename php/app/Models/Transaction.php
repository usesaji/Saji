<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\MorphTo;

#[Fillable([
    'group_id',
    'user_id',
    'type',
    'subject_type',
    'subject_id',
    'stellar_tx_hash',
    'status',
    'explorer_url',
    'meta',
])]
class Transaction extends Model
{
    protected function casts(): array
    {
        return [
            'meta' => 'array',
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

    /** The domain row this tx settled (contribution, payout, ...). */
    public function subject(): MorphTo
    {
        return $this->morphTo();
    }
}
