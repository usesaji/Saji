<?php

namespace App\Http\Controllers\Concerns;

use Throwable;

/**
 * Fire a detached, targeted `chain:index --group={id}` right after an on-chain
 * action so the DB reflects the new state in ~1-2s instead of waiting for the
 * scheduled sweep.
 *
 * It runs as a STANDALONE php process, which can reach the RPC even when the
 * `artisan serve` web worker can't (the "DNS wall"). Fire-and-forget: the HTTP
 * response returns immediately, and any failure just falls back to the periodic
 * scheduler. Shared by every controller that mutates on-chain group state.
 */
trait SpawnsChainReconcile
{
    protected function spawnReconcile(int $groupId): void
    {
        try {
            $artisan = base_path('artisan');
            $php = PHP_BINARY;
            if (str_starts_with(strtoupper(PHP_OS), 'WIN')) {
                // Windows: start a detached, window-less background process.
                pclose(popen("start /B \"\" \"{$php}\" \"{$artisan}\" chain:index --group={$groupId} > NUL 2>&1", 'r'));
            } else {
                // POSIX: background + detach from the request lifecycle.
                exec("\"{$php}\" \"{$artisan}\" chain:index --group={$groupId} > /dev/null 2>&1 &");
            }
        } catch (Throwable $e) {
            report($e); // scheduler will still catch up shortly.
        }
    }
}
