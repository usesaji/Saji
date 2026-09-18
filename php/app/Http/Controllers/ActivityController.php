<?php

namespace App\Http\Controllers;

use App\Models\Transaction;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Activity / Notification feed. One chronological stream of the user's on-chain
 * activity, filterable by the tabs on the screen:
 *   all | contributions | payout | withdrawal
 *
 * Non-custodial note: "withdrawal" is not a separate on-chain action in Saji —
 * money leaves a circle as a `payout` to the recipient's own wallet. So the
 * withdrawal filter maps onto payout transactions (see typesFor()).
 */
class ActivityController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $data = $request->validate([
            'filter' => ['nullable', 'in:all,contributions,payout,withdrawal'],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:100'],
        ]);

        $filter = $data['filter'] ?? 'all';

        $query = Transaction::query()
            ->where('user_id', $request->user()->id)
            ->with(['group:id,name', 'subject'])
            ->when($this->typesFor($filter), fn ($q, $types) => $q->whereIn('type', $types))
            ->latest();

        $page = $query->paginate($data['per_page'] ?? 20);

        // Shape each row for the feed: the amount lives on the settled subject
        // (a contribution/payout), so surface it alongside the tx metadata.
        $page->getCollection()->transform(fn (Transaction $tx) => $this->row($tx));

        return response()->json($page);
    }

    /** Map a screen filter to the concrete transaction types it covers. */
    private function typesFor(string $filter): ?array
    {
        return match ($filter) {
            'contributions' => ['contribution'],
            // Both "payout" and "withdrawal" surface payout transactions —
            // a payout is money leaving the circle to the member's wallet.
            'payout', 'withdrawal' => ['payout'],
            default => null, // 'all' — no type constraint
        };
    }

    /** Compact feed row. */
    private function row(Transaction $tx): array
    {
        return [
            'id' => $tx->id,
            'type' => $tx->type,
            'status' => $tx->status,
            'group' => $tx->group?->only(['id', 'name']),
            'amount' => $this->amountOf($tx),
            'stellar_tx_hash' => $tx->stellar_tx_hash,
            'explorer_url' => $tx->explorer_url,
            'created_at' => $tx->created_at,
        ];
    }

    /** Pull the signed amount from the settled subject row, if any. */
    private function amountOf(Transaction $tx): ?string
    {
        $subject = $tx->subject;
        if (! $subject) {
            return null;
        }

        // Contribution has `amount`; Payout exposes the member's net receipt.
        return match ($tx->type) {
            'contribution' => $subject->amount ?? null,
            'payout' => $subject->net_amount ?? null,
            default => $subject->amount ?? null,
        };
    }
}
