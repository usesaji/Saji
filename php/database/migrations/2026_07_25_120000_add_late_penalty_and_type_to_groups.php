<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Late-penalty policy + group type.
     *
     * late_penalty mirrors the on-chain `LatePenalty` enum: how a missed
     * contribution is handled. Stored now; enforcement ships with the future
     * default-handling upgrade (the strict "everyone pays" rule governs today).
     *
     * group_type backs the Join Group page's "group type" (a public vs private
     * circle — private requires organizer approval, public can auto-approve).
     */
    public function up(): void
    {
        Schema::table('groups', function (Blueprint $table) {
            $table->enum('late_penalty', ['deduct_from_balance', 'remove_member'])
                ->default('deduct_from_balance')->after('grace_period_hours');
            $table->enum('group_type', ['public', 'private'])
                ->default('private')->after('payout_order');
        });
    }

    public function down(): void
    {
        Schema::table('groups', function (Blueprint $table) {
            $table->dropColumn(['late_penalty', 'group_type']);
        });
    }
};
