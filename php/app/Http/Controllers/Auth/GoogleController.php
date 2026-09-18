<?php

namespace App\Http\Controllers\Auth;

use App\Http\Controllers\Controller;
use App\Models\User;
use Illuminate\Http\RedirectResponse;
use Illuminate\Support\Str;
use Laravel\Socialite\Facades\Socialite;
use Throwable;

/**
 * Google sign-in via Socialite. Approved auth standard from the Saji sync call
 * (email + Google only, no phone). Uses the stateless flow so it works for an
 * SPA/API frontend.
 *
 * Non-custodial: sign-in is identity only. The user connects a Stellar wallet
 * at deposit time; the backend never generates or holds a wallet for them.
 */
class GoogleController extends Controller
{
    /** Step 1: send the user to Google. */
    public function redirect(): RedirectResponse
    {
        return Socialite::driver('google')->stateless()->redirect();
    }

    /**
     * Step 2: Google redirects the user's BROWSER back here.
     *
     * Because this is a full-page redirect (not a fetch), we can't return JSON —
     * the browser would just display it. Instead we find-or-create the user, mint
     * a token, and redirect back into the SPA with the token on the URL. A small
     * frontend page reads it, stores it, and forwards to the dashboard.
     */
    public function callback(): RedirectResponse
    {
        try {
            $googleUser = Socialite::driver('google')->stateless()->user();
        } catch (Throwable $e) {
            // User denied consent, or the exchange failed (bad code, misconfigured
            // client). Send them back to login with a flag rather than a stack trace.
            return redirect($this->frontend('/auth/login?error=google'));
        }

        $email = $googleUser->getEmail();

        if (! $email) {
            return redirect($this->frontend('/auth/login?error=google_no_email'));
        }

        // Resolve the account by google_id first (returning Google user), then
        // fall back to email so we LINK Google onto an account that was created
        // another way (email signup) instead of trying to insert a duplicate
        // email and hitting the unique constraint.
        $user = User::where('google_id', $googleUser->getId())
            ->orWhere('email', $email)
            ->first();

        // Identity only — deliberately NOT importing the Google profile photo.
        // The avatar is upload-only: users set their picture via the profile
        // image upload, so a linked account keeps whatever they uploaded (or
        // stays blank until they do).
        $attributes = [
            'google_id' => $googleUser->getId(),
            // Google verifies the address, so mark it verified either way.
            'email_verified_at' => now(),
        ];

        if ($user) {
            // Existing account: link Google + mark verified. Leave the user's own
            // name, email, and uploaded avatar untouched.
            $user->fill($attributes)->save();
        } else {
            // Brand-new user.
            $user = User::create($attributes + [
                'name' => $googleUser->getName() ?? $googleUser->getNickname() ?? 'Saji User',
                'email' => $email,
            ]);
        }

        $token = $user->createToken('api')->plainTextToken;

        return redirect($this->frontend('/auth/google/callback?token='.urlencode($token)));
    }

    /**
     * Build an absolute frontend URL. FRONTEND_URL may be a comma-separated list
     * (dev origins); the first entry is the canonical one we redirect to.
     */
    private function frontend(string $path): string
    {
        $base = Str::of((string) env('FRONTEND_URL', 'http://localhost:3000'))
            ->explode(',')
            ->first();

        return rtrim(trim($base), '/').$path;
    }
}
