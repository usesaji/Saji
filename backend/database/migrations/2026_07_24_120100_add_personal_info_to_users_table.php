<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Personal Info screen: additional profile fields beyond name/email/tag.
     * All nullable — collected on the "additional information" section, not at
     * signup, so existing accounts stay valid.
     */
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->date('date_of_birth')->nullable()->after('avatar_url');
            $table->enum('gender', ['male', 'female', 'other', 'prefer_not_to_say'])
                ->nullable()->after('date_of_birth');
            $table->string('address')->nullable()->after('gender');
        });
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->dropColumn(['date_of_birth', 'gender', 'address']);
        });
    }
};
