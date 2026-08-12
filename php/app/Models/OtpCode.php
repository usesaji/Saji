<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Hidden;
use Illuminate\Database\Eloquent\Model;

/**
 * A one-time email-verification code issued during signup.
 *
 * Only hashes are stored; the plaintext code exists just long enough to be
 * mailed. See the migration for the reasoning behind each column.
 */
#[Fillable([
    'email',
    'code_hash',
    'attempts',
    'expires_at',
    'signup_token_hash',
    'verified_at',
])]
#[Hidden(['code_hash', 'signup_token_hash'])]
class OtpCode extends Model
{
    /** How long a freshly issued code stays valid. */
    public const TTL_MINUTES = 10;

    /** Wrong guesses allowed before the code is burned. */
    public const MAX_ATTEMPTS = 5;

    /** How long the post-verification signup token stays valid. */
    public const SIGNUP_TOKEN_TTL_MINUTES = 30;

    protected function casts(): array
    {
        return [
            'attempts' => 'integer',
            'expires_at' => 'datetime',
            'verified_at' => 'datetime',
        ];
    }

    public function isExpired(): bool
    {
        return $this->expires_at->isPast();
    }

    public function isLockedOut(): bool
    {
        return $this->attempts >= self::MAX_ATTEMPTS;
    }
}
