<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Create Group + Group Rules screens.
     *
     * Split by trust boundary:
     *  - ON-CHAIN mirror (enforced by the Soroban contract): target_amount,
     *    late_fee_bps, grace_period_hours, payout_order. `fee_bps` (service
     *    charge per contribution) already exists.
     *  - OFF-CHAIN (UX/metadata only, safe to keep in the DB): photo_url,
     *    contribution_frequency, auto_approve_join, hide_balances, invite_token.
     */
    public function up(): void
    {
        Schema::table('groups', function (Blueprint $table) {
            // Create Group page
            $table->string('photo_url')->nullable()->after('description');
            // target_amount: the circle's goal (sum each member ultimately
            // receives). Informational alongside the per-cycle contribution.
            $table->decimal('target_amount', 20, 7)->nullable()->after('contribution_amount');
            // How often a contribution is due. 'custom' pairs with cycle_length_days.
            $table->enum('contribution_frequency', ['daily', 'weekly', 'bi_weekly', 'monthly', 'custom'])
                ->default('weekly')->after('cycle_length_days');

            // Group Rules page — on-chain-relevant
            // Penalty a defaulter owes, in bps of the contribution amount.
            $table->unsignedSmallInteger('late_fee_bps')->default(0)->after('fee_bps');
            // How long after the due time a member may still pay before counting
            // as a default (drives the future resolve_default hook in SPEC §7).
            $table->unsignedInteger('grace_period_hours')->default(0)->after('late_fee_bps');
            // How the payout rotation order is decided.
            $table->enum('payout_order', ['random', 'manual', 'vote', 'custom'])
                ->default('manual')->after('grace_period_hours');

            // Group Rules page — off-chain UX
            // Join requests auto-approved (open circle) vs organizer-gated.
            $table->boolean('auto_approve_join')->default(false)->after('payout_order');
            // Hide each member's running balance/contribution from other members.
            $table->boolean('hide_balances')->default(false)->after('auto_approve_join');

            // Invite link page: an unguessable token for join-by-link.
            $table->string('invite_token', 40)->nullable()->unique()->after('hide_balances');
        });
    }

    public function down(): void
    {
        Schema::table('groups', function (Blueprint $table) {
            $table->dropUnique(['invite_token']);
            $table->dropColumn([
                'photo_url', 'target_amount', 'contribution_frequency',
                'late_fee_bps', 'grace_period_hours', 'payout_order',
                'auto_approve_join', 'hide_balances', 'invite_token',
            ]);
        });
    }
};
