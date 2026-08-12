<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * A member's saved amount toward a public savings-challenge target.
     *
     * Non-custodial: the money stays in the member's OWN wallet. A deposit row
     * records a save they made (backed by a real on-chain tx hash), so progress
     * toward the target is truthful and verifiable — not a self-reported number.
     * There is no pool and no rotation here.
     */
    public function up(): void
    {
        Schema::create('challenge_deposits', function (Blueprint $table) {
            $table->id();
            $table->foreignId('group_id')->constrained()->cascadeOnDelete();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();

            $table->decimal('amount', 20, 7);

            // The on-chain tx that backs this save (unique so the same transfer
            // can't be counted twice). Confirmed once seen on-chain.
            $table->string('stellar_tx_hash')->unique();
            $table->enum('status', ['pending', 'confirmed', 'failed'])->default('pending');
            $table->timestamp('confirmed_at')->nullable();

            $table->timestamps();

            $table->index(['group_id', 'user_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('challenge_deposits');
    }
};
