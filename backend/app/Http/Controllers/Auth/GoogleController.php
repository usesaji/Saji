<?php

namespace App\Http\Controllers\Auth;

use App\Http\Controllers\Controller;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\RedirectResponse;
use Laravel\Socialite\Facades\Socialite;

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

    /** Step 2: Google redirects back here; find-or-create the user. */
    public function callback(): JsonResponse
    {
        $googleUser = Socialite::driver('google')->stateless()->user();

        $user = User::updateOrCreate(
            ['google_id' => $googleUser->getId()],
            [
                'name' => $googleUser->getName() ?? $googleUser->getNickname() ?? 'Saji User',
                'email' => $googleUser->getEmail(),
                'avatar_url' => $googleUser->getAvatar(),
            ]
        );

        $token = $user->createToken('api')->plainTextToken;

        return response()->json([
            'user' => $user,
            'token' => $token,
        ]);
    }
}
