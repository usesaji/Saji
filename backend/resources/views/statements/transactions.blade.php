<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <style>
        * { font-family: DejaVu Sans, sans-serif; }
        body { color: #1a1a1a; font-size: 12px; margin: 0; }
        .header { border-bottom: 2px solid #2b6cb0; padding-bottom: 12px; margin-bottom: 16px; }
        .brand { font-size: 22px; font-weight: bold; color: #2b6cb0; }
        .sub { color: #555; font-size: 11px; margin-top: 2px; }
        .meta { margin: 14px 0; font-size: 11px; color: #333; }
        .meta strong { display: inline-block; width: 110px; }
        table { width: 100%; border-collapse: collapse; margin-top: 10px; }
        th { background: #f1f5f9; text-align: left; padding: 7px 8px; font-size: 11px; border-bottom: 1px solid #cbd5e0; }
        td { padding: 6px 8px; border-bottom: 1px solid #edf2f7; font-size: 10.5px; }
        .status-success { color: #22803c; }
        .status-failed  { color: #c53030; }
        .status-pending { color: #b7791f; }
        .hash { font-size: 9px; color: #718096; word-break: break-all; }
        .empty { padding: 20px; text-align: center; color: #718096; }
        .footer { margin-top: 24px; font-size: 9px; color: #a0aec0; text-align: center; }
    </style>
</head>
<body>
    <div class="header">
        <div class="brand">Saji</div>
        <div class="sub">Savings Group Statement</div>
    </div>

    <div class="meta">
        <div><strong>Account</strong> {{ $user->name }} (&#64;{{ $user->tag_name }})</div>
        <div><strong>Email</strong> {{ $user->email }}</div>
        <div><strong>Period</strong> {{ $from ?? 'Beginning' }} &ndash; {{ $to ?? 'Today' }}</div>
        <div><strong>Generated</strong> {{ $generatedAt }}</div>
    </div>

    <table>
        <thead>
            <tr>
                <th>Date</th>
                <th>Type</th>
                <th>Group</th>
                <th>Status</th>
                <th>Transaction</th>
            </tr>
        </thead>
        <tbody>
            @forelse ($rows as $tx)
                <tr>
                    <td>{{ $tx->created_at?->format('Y-m-d H:i') }}</td>
                    <td>{{ ucwords(str_replace('_', ' ', $tx->type)) }}</td>
                    <td>{{ $tx->group?->name ?? '—' }}</td>
                    <td class="status-{{ $tx->status }}">{{ ucfirst($tx->status) }}</td>
                    <td class="hash">{{ $tx->stellar_tx_hash }}</td>
                </tr>
            @empty
                <tr><td colspan="5" class="empty">No transactions in this period.</td></tr>
            @endforelse
        </tbody>
    </table>

    <div class="footer">
        Every transaction is verifiable on the Stellar network. This statement mirrors on-chain state; the ledger is the source of truth.
    </div>
</body>
</html>
