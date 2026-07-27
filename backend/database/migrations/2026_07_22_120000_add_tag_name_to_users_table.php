<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * The user's public @handle, chosen on the Create Profile step.
     *
     * Nullable because Google sign-in users never pass through that step, and
     * unique because it identifies a user publicly (e.g. inviting someone to a
     * savings group by handle rather than by email).
     */
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->string('tag_name')->nullable()->unique()->after('name');
        });
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->dropUnique(['tag_name']);
            $table->dropColumn('tag_name');
        });
    }
};
