<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

#[Fillable([
    'group_id',
    'user_id',
    'status',
    'payout_position',
    'has_received_payout',
    'joined_at',
])]
class GroupMember extends Model
{
    protected function casts(): array
    {
        return [
            'payout_position' => 'integer',
            'has_received_payout' => 'boolean',
            'joined_at' => 'datetime',
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
