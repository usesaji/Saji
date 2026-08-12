<?php

use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Schedule;

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');

// Keep the DB in sync with on-chain state (group status, contributions, activity).
// Runs every 30s (the tightest useful cadence) so background drift is corrected
// fast; user actions ALSO fire a targeted `chain:index --group=N` immediately for
// near-instant updates, so this sweep is the safety net, not the main path.
// Idempotent; withoutOverlapping guards a slow run from stacking.
Schedule::command('chain:index')
    ->everyThirtySeconds()
    ->withoutOverlapping()
    ->runInBackground();
