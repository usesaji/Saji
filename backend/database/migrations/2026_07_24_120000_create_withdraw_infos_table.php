<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Where a user wants payouts to land — backs the "Withdraw Info" screen.
     *
     * Saji is non-custodial: payouts settle on-chain to a Stellar address the
     * user controls. We store only the PUBLIC destination address (never a
     * secret key), plus an optional memo some exchanges/custodians require to
     * credit a deposit, and an optional human label for an off-ramp/bank the
     * user recognises. One primary destination per user (unique user_id).
     */
    public function up(): void
    {
        Schema::create('withdraw_infos', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->unique()->constrained()->cascadeOnDelete();

            // Stellar G... public address the user withdraws to.
            $table->string('stellar_address');
            // Optional memo (text/id) required by some custodial destinations.
            $table->string('memo')->nullable();
            $table->enum('memo_type', ['text', 'id', 'none'])->default('none');

            // Optional off-ramp label the user recognises (e.g. "Binance", "Bank").
            $table->string('destination_label')->nullable();

            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('withdraw_infos');
    }
};
