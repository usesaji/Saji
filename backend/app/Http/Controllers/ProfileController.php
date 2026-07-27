<?php

namespace App\Http\Controllers;

use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/**
 * Backs the Profile screen and its sub-pages:
 *  - show()          the profile header (picture, name, @tag, email)
 *  - update()        Personal Info (name, tag_name)
 *  - uploadAvatar()  the profile picture
 *  - changePassword() Password & Security
 *
 * Non-custodial reminder: nothing here touches keys or funds. A user's linked
 * Stellar address (public only) is surfaced read-only for reference.
 */
class ProfileController extends Controller
{
    /** The Profile header + linked wallet reference. */
    public function show(Request $request): JsonResponse
    {
        $user = $request->user();

        return response()->json([
            'id' => $user->id,
            'name' => $user->name,
            'tag_name' => $user->tag_name,
            'email' => $user->email,
            'avatar_url' => $user->avatar_url,
            'stellar_address' => $user->stellar_address,
            // Additional information section of the Personal Info screen.
            'date_of_birth' => $user->date_of_birth?->toDateString(),
            'gender' => $user->gender,
            'address' => $user->address,
            // Whether this account can change a password (Google-only users can't
            // until they set one). Drives the Password & Security screen.
            'has_password' => (bool) $user->password,
            'is_google_linked' => (bool) $user->google_id,
            // Password & Security screen — the security-setting toggles.
            'security' => [
                'twofa_on_suspicious_withdrawal' => $user->twofa_on_suspicious_withdrawal,
                'lock_after_failed_attempts' => $user->lock_after_failed_attempts,
            ],
        ]);
    }

    /**
     * Password & Security: update the security-setting toggles.
     *  - twofa_on_suspicious_withdrawal
     *  - lock_after_failed_attempts (0 disables the lockout; the Figma preset
     *    is 5, so the UI toggle can send 5 vs 0)
     */
    public function updateSecurity(Request $request): JsonResponse
    {
        $data = $request->validate([
            'twofa_on_suspicious_withdrawal' => ['sometimes', 'boolean'],
            'lock_after_failed_attempts' => ['sometimes', 'integer', 'min:0', 'max:10'],
        ]);

        $user = $request->user();
        $user->update($data);

        return response()->json([
            'twofa_on_suspicious_withdrawal' => $user->twofa_on_suspicious_withdrawal,
            'lock_after_failed_attempts' => $user->lock_after_failed_attempts,
        ]);
    }

    /** Personal Info: update display name and public @tag. */
    public function update(Request $request): JsonResponse
    {
        $user = $request->user();

        $data = $request->validate([
            'name' => ['sometimes', 'required', 'string', 'max:255'],
            'tag_name' => [
                'sometimes', 'required', 'string', 'max:50', 'regex:/^\S+$/',
                Rule::unique('users', 'tag_name')->ignore($user->id),
            ],
            // Additional information (all optional).
            'date_of_birth' => ['sometimes', 'nullable', 'date', 'before:today'],
            'gender' => ['sometimes', 'nullable', 'in:male,female,other,prefer_not_to_say'],
            'address' => ['sometimes', 'nullable', 'string', 'max:255'],
        ], [
            'tag_name.regex' => 'Tag name cannot contain spaces.',
        ]);

        $user->update($data);

        return response()->json($user->fresh());
    }

    /** Profile picture upload. Stores on the public disk, saves the URL. */
    public function uploadAvatar(Request $request): JsonResponse
    {
        $request->validate([
            'avatar' => ['required', 'image', 'mimes:jpeg,jpg,png,webp', 'max:5120'], // 5 MB
        ]);

        $user = $request->user();

        // Replace any previously uploaded avatar (skip external Google URLs).
        if ($user->avatar_url && str_starts_with($user->avatar_url, '/storage/')) {
            $old = str_replace('/storage/', '', $user->avatar_url);
            Storage::disk('public')->delete($old);
        }

        $path = $request->file('avatar')->store('avatars', 'public');
        $url = '/storage/'.$path;

        $user->update(['avatar_url' => $url]);

        return response()->json(['avatar_url' => $url]);
    }

    /**
     * Password & Security: change password.
     *
     * When the account already has a password the current one must be supplied
     * and correct. Google-only users (no password yet) can set one without a
     * current password — this is how they enable email/password login.
     */
    public function changePassword(Request $request): JsonResponse
    {
        $user = $request->user();

        $rules = [
            'password' => ['required', 'string', 'min:8', 'confirmed'],
        ];
        if ($user->password) {
            $rules['current_password'] = ['required', 'string'];
        }

        $data = $request->validate($rules);

        if ($user->password && ! Hash::check($data['current_password'], $user->password)) {
            throw ValidationException::withMessages([
                'current_password' => ['The current password is incorrect.'],
            ]);
        }

        $user->update(['password' => Hash::make($data['password'])]);

        // Security hygiene: revoke every other token so a change logs out other
        // sessions, keeping the one making the change alive.
        $currentId = $request->user()->currentAccessToken()->id;
        $user->tokens()->where('id', '!=', $currentId)->delete();

        return response()->json(['message' => 'Password updated.']);
    }
}
