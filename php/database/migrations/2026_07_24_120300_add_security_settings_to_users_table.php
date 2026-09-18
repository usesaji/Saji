<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Password & Security screen — the "Security setting" toggles.
     *
     *  - twofa_on_suspicious_withdrawal: require a 2FA step when a withdrawal
     *    looks risky (new destination, unusual amount).
     *  - lock_after_failed_attempts: lock the account after N consecutive failed
     *    logins (0 = disabled). failed_login_attempts / locked_until track the
     *    live state the login flow enforces.
     */
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->boolean('twofa_on_suspicious_withdrawal')->default(false)->after('address');
            $table->unsignedTinyInteger('lock_after_failed_attempts')->default(5)->after('twofa_on_suspicious_withdrawal');

            // Live lockout state used by the login throttle.
            $table->unsignedTinyInteger('failed_login_attempts')->default(0)->after('lock_after_failed_attempts');
            $table->timestamp('locked_until')->nullable()->after('failed_login_attempts');
        });
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->dropColumn([
                'twofa_on_suspicious_withdrawal',
                'lock_after_failed_attempts',
                'failed_login_attempts',
                'locked_until',
            ]);
        });
    }
};
