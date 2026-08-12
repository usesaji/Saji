<?php

namespace App\Models;

// use Illuminate\Contracts\Auth\MustVerifyEmail;
use Database\Factories\UserFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Hidden;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;
use Laravel\Sanctum\HasApiTokens;

#[Fillable(['name', 'tag_name', 'email', 'password', 'email_verified_at', 'google_id', 'avatar_url', 'stellar_address', 'date_of_birth', 'gender', 'address', 'twofa_on_suspicious_withdrawal', 'lock_after_failed_attempts', 'failed_login_attempts', 'locked_until'])]
#[Hidden(['password', 'remember_token'])]
class User extends Authenticatable
{
    /** @use HasFactory<UserFactory> */
    use HasApiTokens, HasFactory, Notifiable;

    /** Groups this user organizes. */
    public function organizedGroups(): HasMany
    {
        return $this->hasMany(Group::class, 'organizer_id');
    }

    /** Membership rows across all groups. */
    public function memberships(): HasMany
    {
        return $this->hasMany(GroupMember::class);
    }

    public function contributions(): HasMany
    {
        return $this->hasMany(Contribution::class);
    }

    public function payouts(): HasMany
    {
        return $this->hasMany(Payout::class, 'recipient_id');
    }

    /** All saved payout destinations (public addresses only). */
    public function withdrawDestinations(): HasMany
    {
        return $this->hasMany(WithdrawInfo::class);
    }

    /**
     * The primary payout destination — used as the default when a withdrawal
     * doesn't name one. Falls back to the most recent if none is flagged.
     */
    public function withdrawInfo(): HasOne
    {
        // Prefer the flagged primary; tie-break to the newest destination.
        return $this->hasOne(WithdrawInfo::class)->ofMany([
            'is_primary' => 'max',
            'id' => 'max',
        ]);
    }

    /**
     * Get the attributes that should be cast.
     *
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'email_verified_at' => 'datetime',
            'password' => 'hashed',
            'date_of_birth' => 'date',
            'twofa_on_suspicious_withdrawal' => 'boolean',
            'lock_after_failed_attempts' => 'integer',
            'failed_login_attempts' => 'integer',
            'locked_until' => 'datetime',
        ];
    }
}
