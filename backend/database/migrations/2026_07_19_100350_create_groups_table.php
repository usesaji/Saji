<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * A savings group (Ajo / Esusu / Susu circle).
     *
     * The Soroban contract is the source of truth for money and rotation.
     * This table mirrors that on-chain state and holds off-chain metadata
     * (name, description) that does not belong on-chain.
     */
    public function up(): void
    {
        Schema::create('groups', function (Blueprint $table) {
            $table->id();

            // Off-chain metadata.
            $table->string('name');
            $table->text('description')->nullable();

            // The organizer who created the circle.
            $table->foreignId('organizer_id')->constrained('users')->cascadeOnDelete();

            // On-chain identity. Every group is a group_id inside ONE shared
            // Soroban contract (not a contract-per-group). Nullable until the
            // create_group tx confirms on Testnet.
            $table->unsignedBigInteger('onchain_group_id')->nullable()->unique();
            $table->string('contract_address')->nullable();

            // Group rules — mirror of the on-chain config.
            $table->string('asset_code')->default('USDC'); // default currency, per sync call
            $table->string('asset_issuer')->nullable();     // null = native/known SAC
            $table->decimal('contribution_amount', 20, 7);  // Stellar uses 7 decimals
            $table->unsignedInteger('cycle_length_days')->default(7);
            $table->unsignedSmallInteger('fee_bps')->default(0); // 0%..100% => 0..10000 bps

            // Lifecycle. Private cycles: organizer approves members before start.
            $table->enum('status', ['draft', 'open', 'active', 'completed', 'cancelled'])
                ->default('draft');
            $table->unsignedInteger('current_cycle')->default(0);
            $table->foreignId('next_recipient_id')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('next_payout_at')->nullable();

            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('groups');
    }
};
