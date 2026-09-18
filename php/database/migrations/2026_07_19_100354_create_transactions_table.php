<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * A generic ledger of every Stellar transaction Saji touches, so the
     * dashboard can render a "Recent Activity" feed and verification links
     * to the Stellar explorer. Polymorphic: a row may point at a
     * contribution, a payout, a group creation, etc.
     */
    public function up(): void
    {
        Schema::create('transactions', function (Blueprint $table) {
            $table->id();

            $table->foreignId('group_id')->nullable()->constrained('groups')->nullOnDelete();
            $table->foreignId('user_id')->nullable()->constrained('users')->nullOnDelete();

            // What kind of on-chain action this was.
            $table->enum('type', ['create_group', 'join', 'contribution', 'payout', 'other'])
                ->default('other');

            // Polymorphic link to the domain row this tx settled (optional).
            $table->nullableMorphs('subject'); // subject_type + subject_id

            $table->string('stellar_tx_hash')->unique();
            $table->enum('status', ['pending', 'success', 'failed'])->default('pending');

            // Cached so the explorer link can be built without another lookup.
            $table->string('explorer_url')->nullable();

            $table->json('meta')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('transactions');
    }
};
