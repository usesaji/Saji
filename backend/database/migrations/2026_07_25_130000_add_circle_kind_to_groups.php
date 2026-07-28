<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Two kinds of circle now exist:
     *
     *  - 'rotating'  : the existing Ajo/Esusu closed circle. Pooled escrow,
     *                  strict rules, rotation pays each member once. Backed by
     *                  the Soroban contract.
     *  - 'challenge' : a PUBLIC savings challenge. No pool, no rotation, no
     *                  penalties. Anyone can join; each member saves their OWN
     *                  money (in their own wallet) toward a shared target the
     *                  admin sets. The group is accountability + reminders only.
     *                  Off-chain / non-custodial — no contract escrow.
     *
     * Existing groups default to 'rotating' so nothing changes for them.
     * `savings_target` is the goal amount each member aims for in a challenge.
     */
    public function up(): void
    {
        Schema::table('groups', function (Blueprint $table) {
            $table->enum('circle_kind', ['rotating', 'challenge'])
                ->default('rotating')->after('status')->index();
            // The per-member savings goal for a challenge (null for rotating).
            $table->decimal('savings_target', 20, 7)->nullable()->after('circle_kind');
            // Optional deadline for a challenge (e.g. "save $500 by Dec 31").
            $table->timestamp('challenge_ends_at')->nullable()->after('savings_target');
        });
    }

    public function down(): void
    {
        Schema::table('groups', function (Blueprint $table) {
            $table->dropColumn(['circle_kind', 'savings_target', 'challenge_ends_at']);
        });
    }
};
