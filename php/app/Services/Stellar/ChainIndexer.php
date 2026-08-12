<?php

namespace App\Services\Stellar;

use App\Models\Contribution;
use App\Models\Group;
use App\Models\Payout;
use App\Models\Transaction;
use App\Models\User;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Log;
use Throwable;

/**
 * Reconciles the off-chain database with on-chain contract state.
 *
 * The contract is the source of truth. Money actions can settle on-chain through
 * paths that never told the backend (a wallet signing outside the app, a failed
 * confirm call, a manual invoke). This indexer polls each on-chain group's state
 * and brings the DB into line — regardless of how the change happened — so group
 * status, contributions, and the activity feed are always accurate.
 *
 * It is IDEMPOTENT: running it repeatedly makes no further changes once the DB
 * matches the chain. Intended to run on a schedule (see IndexChainCommand).
 *
 * Approach is state-polling (read the contract's views) rather than event-log
 * streaming: simpler, self-correcting, and works from a normal CLI process
 * (where the RPC is reachable), which is how the scheduler runs.
 */
class ChainIndexer
{
    /** Contract Status enum → our DB status string. */
    private const STATUS_MAP = [
        0 => 'draft',
        1 => 'open',
        2 => 'active',
        3 => 'completed',
    ];

    public function __construct(private readonly StellarService $stellar) {}

    /**
     * Reconcile every group that is live on-chain. Returns a summary of what
     * changed, so a command can report it.
     *
     * @return array{groups_checked:int, status_updated:int, contributions_confirmed:int, payouts_triggered:int, payouts_recorded:int, txns_finalized:int, errors:int}
     */
    public function run(): array
    {
        $summary = [
            'groups_checked' => 0,
            'status_updated' => 0,
            'contributions_confirmed' => 0,
            'payouts_triggered' => 0,
            'payouts_recorded' => 0,
            'txns_finalized' => 0,
            'errors' => 0,
        ];

        Group::query()
            ->whereNotNull('onchain_group_id')
            ->cursor()
            ->each(function (Group $group) use (&$summary) {
                $summary['groups_checked']++;
                try {
                    $result = $this->reconcileGroup($group);
                    $summary['status_updated'] += $result['status_updated'];
                    $summary['contributions_confirmed'] += $result['contributions_confirmed'];
                    $summary['payouts_triggered'] += $result['payouts_triggered'] ?? 0;
                    $summary['payouts_recorded'] += $result['payouts_recorded'] ?? 0;
                } catch (Throwable $e) {
                    // GroupNotFound (Error #1) means the recorded onchain id has no
                    // matching contract group — a stale/bad record, not an indexer
                    // failure. Skip it quietly rather than counting an error.
                    if (str_contains($e->getMessage(), 'Error(Contract, #1)')) {
                        return;
                    }
                    $summary['errors']++;
                    Log::warning("ChainIndexer: group {$group->id} failed", ['e' => $e->getMessage()]);
                }
            });

        $summary['txns_finalized'] = $this->finalizePendingTransactions();

        return $summary;
    }

    /**
     * Finalize pending transactions (e.g. broadcast withdrawals) by reading the
     * network's real result for their hash. Flips pending → success/failed from
     * the CHAIN, so status shown to users reflects settlement, not the optimistic
     * moment of broadcast.
     */
    private function finalizePendingTransactions(): int
    {
        $finalized = 0;

        Transaction::query()
            ->where('status', 'pending')
            ->whereNotNull('stellar_tx_hash')
            ->cursor()
            ->each(function (Transaction $tx) use (&$finalized) {
                try {
                    $status = $this->stellar->getTransactionStatus($tx->stellar_tx_hash);
                    if ($status === 'SUCCESS') {
                        $tx->update(['status' => 'success']);
                        $finalized++;
                    } elseif ($status === 'FAILED') {
                        $tx->update(['status' => 'failed']);
                        $finalized++;
                    }
                    // NOT_FOUND → still settling; leave pending for next run.
                } catch (Throwable $e) {
                    Log::warning("ChainIndexer: tx {$tx->id} status check failed", ['e' => $e->getMessage()]);
                }
            });

        return $finalized;
    }

    /**
     * Reconcile one group against the chain.
     *
     * @return array{status_updated:int, contributions_confirmed:int, payouts_triggered:int, payouts_recorded:int}
     */
    public function reconcileGroup(Group $group): array
    {
        // Serialize per group. The scheduler sweeps every 30s while
        // SpawnsChainReconcile fires a detached process on every contribute /
        // activate, so two runs can overlap on the same group — and both would
        // read "not yet recorded" before either writes, double-counting a payout.
        //
        // A lock rather than a DB transaction: this method invokes the Stellar
        // CLI (up to 120s per call), and holding a DB transaction across that
        // would pin connections and risk lock timeouts. `block(0)` means a
        // concurrent run returns immediately instead of queueing.
        $lock = Cache::lock("chain-reconcile:group:{$group->id}", 180);

        if (! $lock->get()) {
            return ['status_updated' => 0, 'contributions_confirmed' => 0, 'payouts_triggered' => 0, 'payouts_recorded' => 0];
        }

        try {
            return $this->reconcileGroupLocked($group);
        } finally {
            $lock->release();
        }
    }

    /** @return array{status_updated:int, contributions_confirmed:int, payouts_triggered:int, payouts_recorded:int} */
    private function reconcileGroupLocked(Group $group): array
    {
        $onchainId = (int) $group->onchain_group_id;
        $changed = ['status_updated' => 0, 'contributions_confirmed' => 0, 'payouts_triggered' => 0, 'payouts_recorded' => 0];

        // --- 1. Group status + cycle ---
        $state = $this->stellar->getGroupState($onchainId);
        $onchainStatus = self::STATUS_MAP[$state['status'] ?? -1] ?? null;
        $onchainCycle = (int) ($this->stellar->getCycle($onchainId));

        $updates = [];
        if ($onchainStatus !== null && $group->status !== $onchainStatus) {
            $updates['status'] = $onchainStatus;
        }
        if ($group->current_cycle !== $onchainCycle) {
            $updates['current_cycle'] = $onchainCycle;
        }
        if ($updates !== []) {
            $group->update($updates);
            $changed['status_updated'] = 1;
        }

        // Contributions only make sense once the cycle is active.
        if ($onchainStatus !== 'active' && $onchainStatus !== 'completed') {
            return $changed;
        }

        // --- 2. Confirm contributions the chain shows as paid ---
        // Map member addresses → users so we can attribute rows.
        $members = $this->stellar->getMembers($onchainId);
        $allPaid = $members !== [];
        foreach ($members as $address) {
            // A member removed on-chain (defaulted) is skipped everywhere — they
            // no longer owe a contribution, so their absence must NOT block the
            // auto-payout, and their DB membership should reflect the removal.
            if ($this->stellar->isRemoved($onchainId, $address)) {
                $user = User::where('stellar_address', $address)->first();
                if ($user) {
                    $updatedRows = $group->members()
                        ->where('user_id', $user->id)
                        ->where('status', '!=', 'removed')
                        ->update(['status' => 'removed']);
                    if ($updatedRows > 0) {
                        $changed['status_updated'] = 1;
                    }
                }
                continue;
            }

            $user = User::where('stellar_address', $address)->first();

            // Confirm across EVERY cycle 0..current, not just the current one. A
            // cycle can complete + pay out + advance before we reconciled it, so
            // a payment made for an earlier cycle would otherwise be stranded as
            // `pending` forever. `has_contributed` is per-(cycle,member), so we
            // sweep the whole range and confirm whatever the chain shows paid.
            for ($cycle = 0; $cycle <= $onchainCycle; $cycle++) {
                $paid = $this->stellar->hasContributed($onchainId, $cycle, $address);

                // Only the CURRENT cycle drives the "everyone paid → auto-payout"
                // decision below; past cycles were already settled.
                if ($cycle === $onchainCycle && ! $paid) {
                    $allPaid = false;
                }

                if (! $paid || ! $user) {
                    continue;
                }

                $changed['contributions_confirmed'] += $this->confirmContribution($group, $user, $cycle);
            }
        }

        // --- 3. Auto-settle a fully-funded cycle ---
        // The contract's trigger_payout is intentionally permissionless ("can
        // only ever pay the rules-determined recipient"), so the indexer settles
        // on the group's behalf once every member has contributed this cycle.
        // Guarded by $allPaid + status===active: after payout the contract
        // advances the cycle, so the new cycle is no longer all-paid and we
        // won't re-trigger. Best-effort — a failure just retries next run.
        if ($onchainStatus === 'active' && $allPaid) {
            try {
                $this->stellar->triggerPayout($onchainId);
                $changed['payouts_triggered'] = ($changed['payouts_triggered'] ?? 0) + 1;
            } catch (Throwable $e) {
                Log::warning("ChainIndexer: payout trigger failed for group {$group->id}", ['e' => $e->getMessage()]);
            }
        }

        // --- 4. Record payouts a member can now claim ---
        // A completed cycle earmarks the recipient's net as claimable on-chain.
        // Log a Payout + a `payout` activity Transaction for it (once), so the
        // member sees "you were paid X from <circle>" and it feeds the notifier.
        // Idempotent: keyed on the contract's current claimable, only logged when
        // the recorded net doesn't already cover it.
        $changed['payouts_recorded'] = $this->reconcilePayouts($group, $onchainId, $members);

        return $changed;
    }

    /**
     * Log any newly-claimable payout for members of this group. Reads each
     * member's on-chain claimable and, when it exceeds what we've already
     * recorded as a Payout, writes the difference as a Payout + activity
     * Transaction (type=payout) for that member. Returns how many it recorded.
     *
     * @param  array<int,string>  $members  on-chain member addresses
     */
    private function reconcilePayouts(Group $group, int $onchainId, array $members): int
    {
        $recorded = 0;

        // The cycle that just PAID OUT is the one before the current counter —
        // `trigger_payout` advances it as its last step.
        $paidCycle = max(0, (int) $group->current_cycle - 1);

        foreach ($members as $address) {
            $user = User::where('stellar_address', $address)->first();
            if (! $user) {
                continue;
            }

            try {
                $claimableStroops = $this->stellar->claimableOf($onchainId, $address);
            } catch (Throwable) {
                continue; // read blocked — try again next run
            }
            if ($claimableStroops <= 0) {
                continue;
            }

            $claimable = $claimableStroops / 10_000_000;

            // Key on (group, cycle, recipient) and create at most one row.
            //
            // Do NOT diff against the member's lifetime recorded total:
            // `claimableOf` is a CURRENT escrow balance, not a cumulative one, so
            // it drops to 0 the moment the user claims. Subtracting a cumulative
            // sum from it means that after the first claim every later payout
            // computes a delta of <= 0 and is never recorded — the ledger
            // silently stops tracking real payouts, and `payoutSummary.owed`
            // (which bounds withdrawals) goes wrong.
            // Looked up by (group, cycle) because that is the table's unique key
            // — one payout per cycle, matching the rotation. Including the
            // recipient in the lookup would let a mismatch slip past
            // firstOrCreate and then hit the DB constraint as an exception,
            // aborting the sweep for every remaining member.
            $payout = Payout::query()->firstOrCreate(
                [
                    'group_id' => $group->id,
                    'cycle' => $paidCycle,
                ],
                [
                    'recipient_id' => $user->id,
                    'gross_amount' => $claimable,
                    'fee_amount' => 0,
                    'net_amount' => $claimable,
                    // payouts.status enum is pending|submitted|confirmed|failed
                    // (distinct from transactions.status which uses success).
                    'status' => 'confirmed',
                ],
            );

            if (! $payout->wasRecentlyCreated) {
                continue; // already recorded for this cycle
            }

            Transaction::create([
                'group_id' => $group->id,
                'user_id' => $user->id,
                'type' => 'payout',
                'subject_type' => Payout::class,
                'subject_id' => $payout->id,
                'status' => 'success',
            ]);

            $recorded++;
        }

        return $recorded;
    }

    /**
     * Ensure a confirmed contribution row + its activity Transaction exist for
     * one (group, user, cycle). Idempotent — safe to call repeatedly. Returns 1
     * if it created the activity Transaction (i.e. this was newly reconciled),
     * else 0, so the caller can tally "contributions_confirmed".
     */
    private function confirmContribution(Group $group, User $user, int $cycle): int
    {
        $contribution = Contribution::firstOrCreate(
            [
                'group_id' => $group->id,
                'user_id' => $user->id,
                'cycle' => $cycle,
            ],
            [
                'amount' => $group->contribution_amount,
                'status' => 'confirmed',
                'confirmed_at' => now(),
            ]
        );

        if ($contribution->status !== 'confirmed') {
            $contribution->update(['status' => 'confirmed', 'confirmed_at' => now()]);
        }

        // Ensure exactly one activity Transaction exists for it.
        $exists = Transaction::where('subject_type', Contribution::class)
            ->where('subject_id', $contribution->id)
            ->exists();

        if ($exists) {
            return 0;
        }

        Transaction::create([
            'group_id' => $group->id,
            'user_id' => $user->id,
            'type' => 'contribution',
            'subject_type' => Contribution::class,
            'subject_id' => $contribution->id,
            'status' => 'success',
        ]);

        return 1;
    }
}
