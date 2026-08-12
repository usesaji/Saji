<?php

namespace App\Console\Commands;

use App\Models\Group;
use App\Services\Stellar\ChainIndexer;
use Illuminate\Console\Command;

/**
 * Reconcile the database with on-chain contract state.
 *
 *   php artisan chain:index            # reconcile every live group
 *   php artisan chain:index --group=27 # reconcile ONE group (fast path)
 *
 * Runs on a schedule (see routes/console.php) so group status, contributions,
 * and the activity feed stay accurate no matter how an on-chain action happened.
 * The single-group form is spawned right after a member settles a contribution
 * so their record shows immediately — a standalone php process reaches the RPC
 * even when the web worker can't (the DNS wall). Safe to run repeatedly.
 */
class IndexChainCommand extends Command
{
    protected $signature = 'chain:index {--group= : Reconcile only this DB group id}';

    protected $description = 'Reconcile DB state with on-chain contract state (groups, contributions).';

    public function handle(ChainIndexer $indexer): int
    {
        // Fast path: reconcile a single group (used for immediate post-payment
        // reconciliation). Falls back to the full run when no id is given.
        if ($groupId = $this->option('group')) {
            $group = Group::find((int) $groupId);
            if (! $group || $group->onchain_group_id === null) {
                $this->warn("Group {$groupId} not found or not live on-chain.");

                return self::SUCCESS;
            }
            try {
                $indexer->reconcileGroup($group);
                $this->info("Reconciled group {$groupId}.");

                return self::SUCCESS;
            } catch (\Throwable $e) {
                $this->error("Reconcile failed: {$e->getMessage()}");

                return self::FAILURE;
            }
        }

        $this->info('Reconciling with on-chain state…');

        $summary = $indexer->run();

        $this->table(
            ['Groups', 'Status', 'Contribs', 'Pay trig', 'Pay rec', 'Txns fin', 'Errors'],
            [[
                $summary['groups_checked'],
                $summary['status_updated'],
                $summary['contributions_confirmed'],
                $summary['payouts_triggered'],
                $summary['payouts_recorded'],
                $summary['txns_finalized'],
                $summary['errors'],
            ]]
        );

        return $summary['errors'] > 0 ? self::FAILURE : self::SUCCESS;
    }
}
