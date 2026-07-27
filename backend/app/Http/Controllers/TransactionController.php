<?php

namespace App\Http\Controllers;

use App\Models\Transaction;
use Barryvdh\DomPDF\Facade\Pdf;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * The user's Transaction History screen and the "Generate Statement" export.
 *
 * A transaction row is the off-chain mirror of a Stellar tx (contribution,
 * payout, group creation…). Each carries the explorer URL so the user can
 * verify it on-chain — the ledger stays the source of truth.
 */
class TransactionController extends Controller
{
    /** Paginated history for the authenticated user, newest first. */
    public function index(Request $request): JsonResponse
    {
        $data = $request->validate([
            'type' => ['nullable', 'in:create_group,join,contribution,payout,other'],
            'status' => ['nullable', 'in:pending,success,failed'],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:100'],
        ]);

        $query = Transaction::query()
            ->where('user_id', $request->user()->id)
            ->with('group:id,name')
            ->when($data['type'] ?? null, fn ($q, $type) => $q->where('type', $type))
            ->when($data['status'] ?? null, fn ($q, $status) => $q->where('status', $status))
            ->latest();

        return response()->json(
            $query->paginate($data['per_page'] ?? 20)
        );
    }

    /**
     * Transaction Details screen for a single transaction:
     * amount, group, transaction no (hash), and date/time.
     * Scoped to the owner so users only see their own transactions.
     */
    public function show(Request $request, Transaction $transaction): JsonResponse
    {
        abort_unless($transaction->user_id === $request->user()->id, 404);

        $transaction->load(['group:id,name', 'subject']);
        $subject = $transaction->subject;

        $amount = match ($transaction->type) {
            'contribution' => $subject->amount ?? null,
            'payout' => $subject->net_amount ?? null,
            default => $subject->amount ?? null,
        };

        return response()->json([
            'id' => $transaction->id,
            'type' => $transaction->type,
            'status' => $transaction->status,
            'amount' => $amount,
            'group' => $transaction->group?->only(['id', 'name']),
            // "Transaction no" on the details screen — the on-chain hash, with a
            // verification link to the Stellar explorer.
            'transaction_no' => $transaction->stellar_tx_hash,
            'explorer_url' => $transaction->explorer_url,
            'date_time' => $transaction->created_at,
        ]);
    }

    /**
     * Generate Statement: download the user's transaction history for a chosen
     * period in the chosen file type.
     *
     * Matches the Generate Statement screen: file_type (pdf | csv), start_date,
     * end_date. Dates are inclusive Y-m-d bounds; both optional (unbounded when
     * omitted). `from`/`to` are accepted as aliases for the date fields.
     */
    public function statement(Request $request): Response|StreamedResponse
    {
        $data = $request->validate([
            'file_type' => ['nullable', 'in:pdf,csv'],
            'start_date' => ['nullable', 'date'],
            'end_date' => ['nullable', 'date', 'after_or_equal:start_date'],
            // Aliases.
            'from' => ['nullable', 'date'],
            'to' => ['nullable', 'date', 'after_or_equal:from'],
        ]);

        $from = $data['start_date'] ?? $data['from'] ?? null;
        $to = $data['end_date'] ?? $data['to'] ?? null;
        $fileType = $data['file_type'] ?? 'pdf';

        $user = $request->user();

        $rows = Transaction::query()
            ->where('user_id', $user->id)
            ->with('group:id,name')
            ->when($from, fn ($q, $d) => $q->whereDate('created_at', '>=', $d))
            ->when($to, fn ($q, $d) => $q->whereDate('created_at', '<=', $d))
            ->latest()
            ->get();

        $base = 'saji-statement-'.now()->format('Y-m-d');

        if ($fileType === 'csv') {
            return $this->csv($rows, "{$base}.csv");
        }

        $pdf = Pdf::loadView('statements.transactions', [
            'user' => $user,
            'rows' => $rows,
            'from' => $from,
            'to' => $to,
            'generatedAt' => now()->format('Y-m-d H:i'),
        ]);

        return $pdf->download("{$base}.pdf");
    }

    /** Stream the rows as a CSV download. */
    private function csv($rows, string $filename): StreamedResponse
    {
        return response()->streamDownload(function () use ($rows) {
            $out = fopen('php://output', 'w');
            fputcsv($out, ['Date', 'Type', 'Group', 'Status', 'Stellar Tx Hash', 'Explorer URL']);

            foreach ($rows as $tx) {
                fputcsv($out, [
                    $tx->created_at?->toDateTimeString(),
                    $tx->type,
                    $tx->group?->name,
                    $tx->status,
                    $tx->stellar_tx_hash,
                    $tx->explorer_url,
                ]);
            }

            fclose($out);
        }, $filename, [
            'Content-Type' => 'text/csv',
        ]);
    }
}
