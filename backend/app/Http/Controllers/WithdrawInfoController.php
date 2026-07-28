<?php

namespace App\Http\Controllers;

use App\Models\WithdrawInfo;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * The "Withdraw Info" / withdrawal-destinations screen. A user can save
 * MULTIPLE payout destinations ("add new destination / wallet") and mark one
 * primary — the default used when a withdrawal doesn't name a destination.
 *
 * Non-custodial — every destination is a PUBLIC Stellar address (G...) the user
 * controls, optionally a memo some custodial destinations require, and a label.
 * No keys are ever stored.
 */
class WithdrawInfoController extends Controller
{
    /** All of the user's saved destinations, primary first. */
    public function index(Request $request): JsonResponse
    {
        $destinations = $request->user()->withdrawDestinations()
            ->orderByDesc('is_primary')
            ->latest()
            ->get();

        return response()->json($destinations);
    }

    /** Add a new destination. The first one added becomes primary automatically. */
    public function store(Request $request): JsonResponse
    {
        $data = $this->validated($request);
        $user = $request->user();

        $isFirst = ! $user->withdrawDestinations()->exists();
        $makePrimary = ($data['is_primary'] ?? false) || $isFirst;

        $info = DB::transaction(function () use ($user, $data, $makePrimary) {
            if ($makePrimary) {
                $user->withdrawDestinations()->update(['is_primary' => false]);
            }

            return $user->withdrawDestinations()->create([
                'stellar_address' => $data['stellar_address'],
                'memo' => $data['memo'] ?? null,
                'memo_type' => $data['memo_type'] ?? 'none',
                'destination_label' => $data['destination_label'] ?? null,
                'is_primary' => $makePrimary,
            ]);
        });

        return response()->json($info, 201);
    }

    /** Update one of the user's destinations. */
    public function update(Request $request, WithdrawInfo $withdrawInfo): JsonResponse
    {
        $this->authorizeOwner($request, $withdrawInfo);
        $data = $this->validated($request);

        DB::transaction(function () use ($request, $withdrawInfo, $data) {
            if (($data['is_primary'] ?? false) && ! $withdrawInfo->is_primary) {
                $request->user()->withdrawDestinations()->update(['is_primary' => false]);
            }

            $withdrawInfo->update([
                'stellar_address' => $data['stellar_address'],
                'memo' => $data['memo'] ?? null,
                'memo_type' => $data['memo_type'] ?? 'none',
                'destination_label' => $data['destination_label'] ?? null,
                'is_primary' => $data['is_primary'] ?? $withdrawInfo->is_primary,
            ]);
        });

        return response()->json($withdrawInfo->fresh());
    }

    /** Mark a destination primary. */
    public function setPrimary(Request $request, WithdrawInfo $withdrawInfo): JsonResponse
    {
        $this->authorizeOwner($request, $withdrawInfo);

        DB::transaction(function () use ($request, $withdrawInfo) {
            $request->user()->withdrawDestinations()->update(['is_primary' => false]);
            $withdrawInfo->update(['is_primary' => true]);
        });

        return response()->json($withdrawInfo->fresh());
    }

    /** Delete a destination. If it was primary, promote the newest remaining. */
    public function destroy(Request $request, WithdrawInfo $withdrawInfo): JsonResponse
    {
        $this->authorizeOwner($request, $withdrawInfo);

        DB::transaction(function () use ($request, $withdrawInfo) {
            $wasPrimary = $withdrawInfo->is_primary;
            $withdrawInfo->delete();

            if ($wasPrimary) {
                $next = $request->user()->withdrawDestinations()->latest()->first();
                $next?->update(['is_primary' => true]);
            }
        });

        return response()->json(['message' => 'Destination removed.']);
    }

    /** Shared validation for the destination fields. */
    private function validated(Request $request): array
    {
        return $request->validate([
            // Stellar StrKey public address: starts with G, base32, 56 chars.
            'stellar_address' => ['required', 'string', 'regex:/^G[A-Z2-7]{55}$/'],
            'memo' => ['nullable', 'string', 'max:64'],
            'memo_type' => ['nullable', 'in:text,id,none'],
            'destination_label' => ['nullable', 'string', 'max:100'],
            'is_primary' => ['nullable', 'boolean'],
        ], [
            'stellar_address.regex' => 'That is not a valid Stellar public address.',
        ]);
    }

    /** Ensure the destination belongs to the requesting user. */
    private function authorizeOwner(Request $request, WithdrawInfo $withdrawInfo): void
    {
        abort_unless($withdrawInfo->user_id === $request->user()->id, 404);
    }
}
