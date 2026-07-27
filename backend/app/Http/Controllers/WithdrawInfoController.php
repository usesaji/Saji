<?php

namespace App\Http\Controllers;

use App\Models\WithdrawInfo;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * The "Withdraw Info" screen: view / set where payouts should land.
 *
 * Non-custodial — we store a PUBLIC Stellar address (G...) the user controls,
 * optionally a memo some destinations require, and a friendly label. No keys.
 */
class WithdrawInfoController extends Controller
{
    /** Current withdraw destination, or null if not set yet. */
    public function show(Request $request): JsonResponse
    {
        return response()->json($request->user()->withdrawInfo);
    }

    /** Create or update the user's single payout destination. */
    public function upsert(Request $request): JsonResponse
    {
        $data = $request->validate([
            // Stellar StrKey public address: starts with G, base32, 56 chars.
            'stellar_address' => ['required', 'string', 'regex:/^G[A-Z2-7]{55}$/'],
            'memo' => ['nullable', 'string', 'max:64'],
            'memo_type' => ['nullable', 'in:text,id,none'],
            'destination_label' => ['nullable', 'string', 'max:100'],
        ], [
            'stellar_address.regex' => 'That is not a valid Stellar public address.',
        ]);

        $info = WithdrawInfo::updateOrCreate(
            ['user_id' => $request->user()->id],
            [
                'stellar_address' => $data['stellar_address'],
                'memo' => $data['memo'] ?? null,
                'memo_type' => $data['memo_type'] ?? 'none',
                'destination_label' => $data['destination_label'] ?? null,
            ],
        );

        return response()->json($info, $info->wasRecentlyCreated ? 201 : 200);
    }
}
