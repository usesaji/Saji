<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * A single contribution a member paid into a group for a given cycle.
     *
     * This is an off-chain INDEX of on-chain events, not the source of truth:
     * the chain indexer writes rows here after confirming the `contribute` tx,
     * so the dashboard can query fast without trusting the DB for balances.
     */
    public function up(): void
    {
        Schema::create('contributions', function (Blueprint $table) {
            $table->id();

            $table->foreignId('group_id')->constrained('groups')->cascadeOnDelete();
            $table->foreignId('user_id')->constrained('users')->cascadeOnDelete();

            $table->unsignedInteger('cycle');
            $table->decimal('amount', 20, 7);

            // Lifecycle from "user asked to pay" -> "confirmed on Stellar".
            $table->enum('status', ['pending', 'submitted', 'confirmed', 'failed'])
                ->default('pending');

            // Set once confirmed on-chain.
            $table->string('stellar_tx_hash')->nullable()->unique();
            $table->timestamp('confirmed_at')->nullable();

            $table->timestamps();

            // One confirmed contribution per member per cycle (enforced on-chain too).
            $table->unique(['group_id', 'user_id', 'cycle']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('contributions');
    }
};
