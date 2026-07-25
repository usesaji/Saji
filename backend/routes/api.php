<?php

use App\Http\Controllers\ActivityController;
use App\Http\Controllers\Auth\AuthController;
use App\Http\Controllers\Auth\GoogleController;
use App\Http\Controllers\Auth\OtpController;
use App\Http\Controllers\ContributionController;
use App\Http\Controllers\DashboardController;
use App\Http\Controllers\GroupController;
use App\Http\Controllers\ProfileController;
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
    Route::post('/profile/password', [ProfileController::class, 'changePassword']);
    Route::patch('/profile/security', [ProfileController::class, 'updateSecurity']);

    // Withdraw info: where payouts should land (public address only).
    Route::get('/withdraw-info', [WithdrawInfoController::class, 'show']);
    Route::put('/withdraw-info', [WithdrawInfoController::class, 'upsert']);

    // Activity / Notification feed (filters: all|contributions|payout|withdrawal).
    Route::get('/activity', [ActivityController::class, 'index']);

    // Transaction history + details + generate statement (PDF/CSV export).
    Route::get('/transactions', [TransactionController::class, 'index']);
    Route::get('/transactions/statement', [TransactionController::class, 'statement']);
    Route::get('/transactions/{transaction}', [TransactionController::class, 'show']);

    // Wallet (non-custodial): balance, fund info, withdraw, history.
    Route::get('/wallet/balance', [WalletController::class, 'balance']);
    Route::get('/wallet/fund', [WalletController::class, 'fund']);
    Route::post('/wallet/withdraw', [WalletController::class, 'withdraw']);
    Route::post('/wallet/withdraw/submit', [WalletController::class, 'submitWithdraw']);
    Route::get('/wallet/history', [WalletController::class, 'history']);

    // Groups
    Route::get('/groups', [GroupController::class, 'index']);
    Route::post('/groups', [GroupController::class, 'store']);
    Route::get('/groups/{group}', [GroupController::class, 'show']);
    Route::post('/groups/{group}/join', [GroupController::class, 'join']);
    Route::post('/groups/{group}/members/{member}/approve', [GroupController::class, 'approve']);
    // Invite link page: organizer fetches the shareable link; anyone joins by token.
    Route::get('/groups/{group}/invite-link', [GroupController::class, 'inviteLink']);
    Route::post('/groups/join/{token}', [GroupController::class, 'joinByToken']);
    // Broadcast a wallet-signed tx (create_group / join / contribution) on-chain.
    Route::post('/groups/{group}/submit', [GroupController::class, 'submitOnchain']);

    // Contributions
    Route::get('/groups/{group}/contributions', [ContributionController::class, 'index']);
    Route::post('/groups/{group}/contributions', [ContributionController::class, 'store']);

    // Dashboard
    Route::get('/groups/{group}/dashboard', [DashboardController::class, 'show']);
});
