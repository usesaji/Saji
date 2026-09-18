<?php

use App\Http\Controllers\ActivityController;
use App\Http\Controllers\Auth\AuthController;
use App\Http\Controllers\Auth\GoogleController;
use App\Http\Controllers\Auth\OtpController;
use App\Http\Controllers\ChallengeController;
use App\Http\Controllers\ContributionController;
use App\Http\Controllers\DashboardController;
use App\Http\Controllers\GroupController;
use App\Http\Controllers\ProfileController;
use App\Http\Controllers\PublicCircleController;
use App\Http\Controllers\TransactionController;
use App\Http\Controllers\UserDashboardController;
use App\Http\Controllers\WalletController;
use App\Http\Controllers\WithdrawInfoController;
use Illuminate\Support\Facades\Route;

/*
|--------------------------------------------------------------------------
| Saji API routes
|--------------------------------------------------------------------------
| Auth: email/password + Google (Socialite). No phone auth (per sync call).
| Money & rotation live on-chain (Soroban); these endpoints orchestrate and
| mirror that state.
*/

// --- Public auth ---
// Throttled: these endpoints mail codes and check credentials, so they are the
// natural targets for brute force and mail-bombing.
Route::middleware('throttle:6,1')->group(function () {
    Route::post('/auth/register/start', [OtpController::class, 'start']);
    Route::post('/auth/register/verify-otp', [OtpController::class, 'verify']);
    Route::post('/auth/register/complete-profile', [OtpController::class, 'completeProfile']);
    Route::post('/auth/login', [AuthController::class, 'login']);
});

// Single-shot registration (name + email + password), kept for API clients that
// don't use the multi-step OTP flow.
Route::post('/auth/register', [AuthController::class, 'register']);
Route::get('/auth/google/redirect', [GoogleController::class, 'redirect']);
Route::get('/auth/google/callback', [GoogleController::class, 'callback']);

// --- Authenticated ---
Route::middleware('auth:sanctum')->group(function () {
    Route::get('/auth/me', [AuthController::class, 'me']);
    Route::post('/auth/logout', [AuthController::class, 'logout']);

    // User home dashboard: saved balance, current circles, quick deposit.
    Route::get('/dashboard', [UserDashboardController::class, 'show']);

    // Profile screen + sub-pages (personal info, picture, password & security).
    Route::get('/profile', [ProfileController::class, 'show']);
    Route::patch('/profile', [ProfileController::class, 'update']);
    Route::post('/profile/avatar', [ProfileController::class, 'uploadAvatar']);
    // Link/unlink the user's Stellar wallet (public address only, non-custodial).
    Route::patch('/profile/wallet', [ProfileController::class, 'linkWallet']);
    Route::post('/profile/password', [ProfileController::class, 'changePassword']);
    Route::patch('/profile/security', [ProfileController::class, 'updateSecurity']);

    // Withdraw destinations: multiple saved payout targets (public address only).
    Route::get('/withdraw-info', [WithdrawInfoController::class, 'index']);
    Route::post('/withdraw-info', [WithdrawInfoController::class, 'store']);
    Route::patch('/withdraw-info/{withdrawInfo}', [WithdrawInfoController::class, 'update']);
    Route::post('/withdraw-info/{withdrawInfo}/primary', [WithdrawInfoController::class, 'setPrimary']);
    Route::delete('/withdraw-info/{withdrawInfo}', [WithdrawInfoController::class, 'destroy']);

    // Activity / Notification feed (filters: all|contributions|payout|withdrawal).
    Route::get('/activity', [ActivityController::class, 'index']);

    // Transaction history + details + generate statement (PDF/CSV export).
    Route::get('/transactions', [TransactionController::class, 'index']);
    Route::get('/transactions/statement', [TransactionController::class, 'statement']);
    Route::get('/transactions/{transaction}', [TransactionController::class, 'show']);

    // Wallet (non-custodial): balance, withdraw, history. Funding is
    // connect-wallet + sign (the contract pulls funds directly) — there is no
    // deposit-address or fiat on-ramp step.
    Route::get('/wallet/balance', [WalletController::class, 'balance']);
    // "Saji balance": total withdrawable = claimable circle payouts + wallet.
    Route::get('/wallet/saji-balance', [WalletController::class, 'sajiBalance']);
    // The user's live circles (DB only) — frontend reads claimables client-side.
    Route::get('/wallet/my-circles', [WalletController::class, 'myCircles']);
    // What Saji has paid this user vs. what they've withdrawn (DB only). Caps
    // the "in your wallet" figure so we never offer to withdraw their own funds.
    Route::get('/wallet/payout-summary', [WalletController::class, 'payoutSummary']);
    Route::post('/wallet/withdraw', [WalletController::class, 'withdraw']);
    // Log a client-side-broadcast withdrawal (Horizon in the browser).
    Route::post('/wallet/withdraw/log', [WalletController::class, 'logWithdrawal']);
    Route::post('/wallet/withdraw/submit', [WalletController::class, 'submitWithdraw']);
    Route::get('/wallet/history', [WalletController::class, 'history']);

    // Public savings challenges (open circles): browse, create, join, leave.
    Route::get('/challenges', [PublicCircleController::class, 'index']);
    Route::post('/challenges', [PublicCircleController::class, 'store']);
    Route::post('/challenges/{group}/join', [PublicCircleController::class, 'join']);
    Route::post('/challenges/{group}/leave', [PublicCircleController::class, 'leave']);
    // Challenge progress: save toward the target, my progress, circle summary.
    Route::get('/challenges/{group}/summary', [ChallengeController::class, 'summary']);
    Route::get('/challenges/{group}/progress', [ChallengeController::class, 'myProgress']);
    Route::post('/challenges/{group}/deposit', [ChallengeController::class, 'deposit']);

    // Groups
    Route::get('/groups', [GroupController::class, 'index']);
    Route::post('/groups', [GroupController::class, 'store']);
    Route::get('/groups/{group}', [GroupController::class, 'show']);
    Route::get('/groups/{group}/circle', [GroupController::class, 'circle']);
    Route::post('/groups/{group}/photo', [GroupController::class, 'uploadPhoto']);
    // Joining is LINK-ONLY — see /groups/join/{token} below. No join-by-id.
    Route::post('/groups/{group}/members/{member}/approve', [GroupController::class, 'approve']);
    Route::delete('/groups/{group}/members/{member}', [GroupController::class, 'decline']);
    // Drag-and-drop "who gets paid first": set the manual payout order.
    Route::post('/groups/{group}/payout-order', [GroupController::class, 'setPayoutOrder']);
    // Invite link page: organizer fetches the shareable link; anyone joins by token.
    Route::get('/groups/{group}/invite-link', [GroupController::class, 'inviteLink']);
    Route::get('/groups/join/{token}', [GroupController::class, 'joinPreview']);
    Route::post('/groups/join/{token}', [GroupController::class, 'joinByToken']);
    // Broadcast a wallet-signed tx (create_group / join / contribution) on-chain.
    Route::post('/groups/{group}/submit', [GroupController::class, 'submitOnchain']);
    // Record the on-chain group id after the frontend created it directly via
    // the contract bindings (client-side signing).
    Route::patch('/groups/{group}/onchain', [GroupController::class, 'recordOnchain']);
    // Mark the group active after the cycle is started on-chain (status sync).
    Route::post('/groups/{group}/activate', [GroupController::class, 'activate']);

    // Contributions
    Route::get('/groups/{group}/contributions', [ContributionController::class, 'index']);
    Route::post('/groups/{group}/contributions', [ContributionController::class, 'store']);
    // Confirm an on-chain-settled contribution (frontend reports the tx until an
    // indexer exists): flips pending -> confirmed.
    Route::post('/groups/{group}/contributions/confirm', [ContributionController::class, 'confirm']);

    // Dashboard
    Route::get('/groups/{group}/dashboard', [DashboardController::class, 'show']);
});
