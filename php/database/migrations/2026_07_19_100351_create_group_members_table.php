<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Membership of a user in a savings group, plus their position in the
     * payout rotation. Private cycles require organizer approval, so a row
     * can exist in a 'pending' state before the member is admitted on-chain.
     */
    public function up(): void
    {
        Schema::create('group_members', function (Blueprint $table) {
            $table->id();

            $table->foreignId('group_id')->constrained('groups')->cascadeOnDelete();
            $table->foreignId('user_id')->constrained('users')->cascadeOnDelete();

            // Approval workflow for private cycles.
            $table->enum('status', ['pending', 'approved', 'active', 'removed'])
                ->default('pending');

            // Position in the rotation (1-based). Determines payout order.
            // Null until the member is admitted and the order is fixed on-chain.
            $table->unsignedInteger('payout_position')->nullable();
            $table->boolean('has_received_payout')->default(false);

            $table->timestamp('joined_at')->nullable();
            $table->timestamps();

            // A user joins a given group at most once.
            $table->unique(['group_id', 'user_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('group_members');
    }
};
