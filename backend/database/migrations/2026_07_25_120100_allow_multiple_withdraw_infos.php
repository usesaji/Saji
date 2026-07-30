<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * The Withdrawal page now supports MULTIPLE saved destinations ("add new
     * destination / wallet"), with one marked primary. Drop the one-per-user
     * unique constraint and add an is_primary flag.
     */
    public function up(): void
    {
        Schema::table('withdraw_infos', function (Blueprint $table) {
            $table->dropUnique(['user_id']);
            $table->boolean('is_primary')->default(false)->after('destination_label');
            $table->index('user_id');
        });

        // The single existing destination per user becomes their primary.
        \Illuminate\Support\Facades\DB::table('withdraw_infos')->update(['is_primary' => true]);
    }

    public function down(): void
    {
        Schema::table('withdraw_infos', function (Blueprint $table) {
            $table->dropIndex(['user_id']);
            $table->dropColumn('is_primary');
            $table->unique('user_id');
        });
    }
};
