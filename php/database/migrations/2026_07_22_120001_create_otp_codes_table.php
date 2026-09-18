<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Email-verification codes for the multi-step signup.
     *
     * Security notes:
     * - `code_hash` stores a HASH of the OTP, never the plaintext. A leaked DB
     *   snapshot must not let an attacker verify someone else's email.
     * - `attempts` caps brute force: a 4-digit code is only 10k possibilities,
     *   so unlimited guesses would be trivially broken.
     * - `signup_token_hash` is issued only AFTER a correct code and is what the
     *   final complete-profile call presents, so that step cannot be reached by
     *   simply POSTing an email address.
     */
    public function up(): void
    {
        Schema::create('otp_codes', function (Blueprint $table) {
            $table->id();

            $table->string('email')->index();
            $table->string('code_hash');
            $table->unsignedTinyInteger('attempts')->default(0);
            $table->timestamp('expires_at');

            // Set once the code is verified; proves the email was confirmed.
            $table->string('signup_token_hash')->nullable()->unique();
            $table->timestamp('verified_at')->nullable();

            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('otp_codes');
    }
};
