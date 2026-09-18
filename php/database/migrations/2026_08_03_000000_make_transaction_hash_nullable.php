<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * A transaction can be logged before (or without) an on-chain hash — e.g. a
 * contribution confirmed client-side where the hash wasn't captured. The column
 * was NOT NULL + unique, which blocked those rows entirely and left the activity
 * feed empty. Make it nullable (still unique; SQLite/most DBs allow many NULLs).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('transactions', function (Blueprint $table) {
            $table->string('stellar_tx_hash')->nullable()->change();
        });
    }

    public function down(): void
    {
        Schema::table('transactions', function (Blueprint $table) {
            $table->string('stellar_tx_hash')->nullable(false)->change();
        });
    }
};
