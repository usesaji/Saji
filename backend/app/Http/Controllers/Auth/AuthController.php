<?php

namespace App\Http\Controllers\Auth;

use App\Http\Controllers\Controller;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Validation\ValidationException;

class AuthController extends Controller
{
    /**
     * Register with email + password (no phone auth, per the Saji sync call).
     *
     * Saji is non-custodial: sign-in establishes identity only. The user's
     * Stellar wallet is connected at deposit time and never held by the
     * backend, so no wallet address is generated or stored here.
     */
    public function register(Request $request): JsonResponse
    {
        $data = $request->validate([
            'name' => ['required', 'string', 'max:255'],
            'email' => ['required', 'email', 'max:255', 'unique:users,email'],
            'password' => ['required', 'string', 'min:8', 'confirmed'],
        ]);

        $user = User::create([
            'name' => $data['name'],
            'email' => $data['email'],
            'password' => Hash::make($data['password']),
        ]);

        $token = $user->createToken('api')->plainTextToken;

        return response()->json([
            'user' => $user,
            'token' => $token,
        ], 201);
    }

    /**
     * Log in with email + password, returning a Sanctum bearer token.
     */
    public function login(Request $request): JsonResponse
    {
        $data = $request->validate([
            'email' => ['required', 'email'],
            'password' => ['required', 'string'],
        ]);

        $user = User::where('email', $data['email'])->first();

        // Account lockout (Password & Security setting). While locked, reject
        // even a correct password until the window passes.
        if ($user && $user->locked_until && $user->locked_until->isFuture()) {
            throw ValidationException::withMessages([
                'email' => ['This account is temporarily locked. Try again later.'],
            ]);
        }

        if (! $user || ! $user->password || ! Hash::check($data['password'], $user->password)) {
            // Count the failure and lock the account once the user's configured
            // threshold is reached (0 disables the lockout).
            if ($user && $user->lock_after_failed_attempts > 0) {
                $attempts = $user->failed_login_attempts + 1;
                $lock = $attempts >= $user->lock_after_failed_attempts;

                $user->forceFill([
                    'failed_login_attempts' => $lock ? 0 : $attempts,
                    'locked_until' => $lock ? now()->addMinutes(15) : $user->locked_until,
                ])->save();
            }

            throw ValidationException::withMessages([
                'email' => ['The provided credentials are incorrect.'],
            ]);
        }

        // Successful login clears the failure counter.
        if ($user->failed_login_attempts > 0 || $user->locked_until) {
            $user->forceFill(['failed_login_attempts' => 0, 'locked_until' => null])->save();
        }

        $token = $user->createToken('api')->plainTextToken;

        return response()->json([
            'user' => $user,
            'token' => $token,
        ]);
    }

    /** The authenticated user. */
    public function me(Request $request): JsonResponse
    {
        return response()->json($request->user());
    }

    /** Revoke the current token. */
    public function logout(Request $request): JsonResponse
    {
        $request->user()->currentAccessToken()->delete();

        return response()->json(['message' => 'Logged out.']);
    }
}
