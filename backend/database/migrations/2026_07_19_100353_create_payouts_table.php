<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * A payout of the pooled funds to the cycle's recipient.
     *
     * Off-chain index of the on-chain `trigger_payout` result. The scheduler
     * dispatches the on-chain payout; the indexer records the outcome here.
     */
    public function up(): void
    {
        Schema::create('payouts', function (Blueprint $table) {
            $table->id();

            $table->foreignId('group_id')->constrained('groups')->cascadeOnDelete();
            $table->foreignId('recipient_id')->constrained('users')->cascadeOnDelete();

            $table->unsignedInteger('cycle');
            $table->decimal('gross_amount', 20, 7); // pool total before fee
            $table->decimal('fee_amount', 20, 7)->default(0);
            $table->decimal('net_amount', 20, 7);   // what the recipient received

            $table->enum('status', ['pending', 'submitted', 'confirmed', 'failed'])
                ->default('pending');

            $table->string('stellar_tx_hash')->nullable()->unique();
            $table->timestamp('confirmed_at')->nullable();

            $table->timestamps();

            // One payout per group per cycle.
            $table->unique(['group_id', 'cycle']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('payouts');
    }
};
