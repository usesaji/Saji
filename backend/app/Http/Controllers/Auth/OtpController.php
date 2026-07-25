<?php

namespace App\Http\Controllers\Auth;

use App\Http\Controllers\Controller;
use App\Mail\OtpCodeMail;
use App\Models\OtpCode;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

/**
 * Multi-step signup: email -> OTP -> profile.
 *
 * Step 1 `start`            mails a 4-digit code.
 * Step 2 `verify`           exchanges a correct code for a short-lived signup token.
 * Step 3 `completeProfile`  exchanges that token + profile fields for a real user
 *                           and a Sanctum bearer token.
 *
 * The signup token is what makes this safe: without it, step 3 would create an
 * account for any email an attacker typed, and the verification step would be
 * decorative.
 */
class OtpController extends Controller
{
    /**
     * Step 1 — issue a code.
     *
     * Responds identically whether or not the email is already registered, so
     * this endpoint cannot be used to enumerate accounts. When the address IS
     * taken we simply skip sending.
     */
    public function start(Request $request): JsonResponse
    {
        $data = $request->validate([
            'email' => ['required', 'email', 'max:255'],
        ]);

        $email = Str::lower($data['email']);

        if (! User::where('email', $email)->exists()) {
            // 4 digits to match the frontend's 4-slot input.
            $code = str_pad((string) random_int(0, 9999), 4, '0', STR_PAD_LEFT);

            // One live code per address: drop any previous, unverified request.
            OtpCode::where('email', $email)->delete();

            OtpCode::create([
                'email' => $email,
                'code_hash' => Hash::make($code),
                'expires_at' => now()->addMinutes(OtpCode::TTL_MINUTES),
            ]);

            Mail::to($email)->send(new OtpCodeMail($code, OtpCode::TTL_MINUTES));

            // Dev convenience: surface the code as a clean one-liner in the log
            // so it's easy to find while the mailer is set to `log`.
            if (app()->isLocal()) {
                \Illuminate\Support\Facades\Log::info("OTP for {$email}: {$code}");
            }
        }

        return response()->json([
            'message' => 'If that address can be registered, a code has been sent.',
            'expires_in_minutes' => OtpCode::TTL_MINUTES,
        ]);
    }

    /**
     * Step 2 — check the code, return a signup token.
     *
     * The row is locked for the duration so two concurrent requests cannot both
     * consume the same attempt budget or both mint a token.
     */
    public function verify(Request $request): JsonResponse
    {
        $data = $request->validate([
            'email' => ['required', 'email', 'max:255'],
            'otp' => ['required', 'string', 'digits:4'],
        ]);

        $email = Str::lower($data['email']);

        $signupToken = DB::transaction(function () use ($email, $data) {
            $otp = OtpCode::where('email', $email)->lockForUpdate()->first();

            if (! $otp || $otp->isExpired() || $otp->isLockedOut()) {
                $this->rejectCode();
            }

            // Hash::check is constant-time, so a wrong code leaks no timing hint.
            if (! Hash::check($data['otp'], $otp->code_hash)) {
                $otp->increment('attempts');
                $this->rejectCode();
            }

            // Correct: mint a single-use token and clear the code so it cannot
            // be replayed.
            $plainToken = Str::random(64);

            $otp->update([
                'code_hash' => '',
                'signup_token_hash' => hash('sha256', $plainToken),
                'verified_at' => now(),
                'expires_at' => now()->addMinutes(OtpCode::SIGNUP_TOKEN_TTL_MINUTES),
            ]);

            return $plainToken;
        });

        return response()->json([
            'message' => 'Email verified.',
            'signup_token' => $signupToken,
        ]);
    }

    /**
     * Step 3 — create the account.
     *
     * Requires the signup token from step 2, so the email on the new user is
     * always one that was actually verified.
     */
    public function completeProfile(Request $request): JsonResponse
    {
        $data = $request->validate([
            'signup_token' => ['required', 'string'],
            'name' => ['required', 'string', 'max:255'],
            'tag_name' => [
                'required', 'string', 'max:50', 'regex:/^\S+$/', 'unique:users,tag_name',
            ],
            'password' => ['required', 'string', 'min:8', 'confirmed'],
        ], [
            'tag_name.regex' => 'Tag name cannot contain spaces.',
        ]);

        $user = DB::transaction(function () use ($data) {
            $otp = OtpCode::where('signup_token_hash', hash('sha256', $data['signup_token']))
                ->whereNotNull('verified_at')
                ->lockForUpdate()
                ->first();

            if (! $otp || $otp->isExpired()) {
                throw ValidationException::withMessages([
                    'signup_token' => ['Your verification has expired. Please start again.'],
                ]);
            }

            // Guard the race between step 2 and step 3.
            if (User::where('email', $otp->email)->exists()) {
                throw ValidationException::withMessages([
                    'email' => ['An account with that email already exists.'],
                ]);
            }

            $user = User::create([
                'name' => $data['name'],
                'tag_name' => $data['tag_name'],
                'email' => $otp->email,
                'password' => Hash::make($data['password']),
                'email_verified_at' => now(),
            ]);

            // Burn the token — one signup per verification.
            $otp->delete();

            return $user;
        });

        return response()->json([
            'user' => $user,
            'token' => $user->createToken('api')->plainTextToken,
        ], 201);
    }

    /**
     * One message for every failure mode (wrong, expired, locked out, never
     * issued) so probing cannot distinguish them.
     *
     * @throws ValidationException
     */
    private function rejectCode(): never
    {
        throw ValidationException::withMessages([
            'otp' => ['That code is invalid or has expired.'],
        ]);
    }
}
