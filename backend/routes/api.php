<?php

use App\Http\Controllers\Auth\AuthController;
use App\Http\Controllers\Auth\GoogleController;
use App\Http\Controllers\ContributionController;
use App\Http\Controllers\DashboardController;
use App\Http\Controllers\GroupController;
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
Route::post('/auth/register', [AuthController::class, 'register']);
Route::post('/auth/login', [AuthController::class, 'login']);
Route::get('/auth/google/redirect', [GoogleController::class, 'redirect']);
Route::get('/auth/google/callback', [GoogleController::class, 'callback']);

// --- Authenticated ---
Route::middleware('auth:sanctum')->group(function () {
    Route::get('/auth/me', [AuthController::class, 'me']);
    Route::post('/auth/logout', [AuthController::class, 'logout']);

    // Groups
    Route::get('/groups', [GroupController::class, 'index']);
    Route::post('/groups', [GroupController::class, 'store']);
    Route::get('/groups/{group}', [GroupController::class, 'show']);
    Route::post('/groups/{group}/join', [GroupController::class, 'join']);
    Route::post('/groups/{group}/members/{member}/approve', [GroupController::class, 'approve']);

    // Contributions
    Route::get('/groups/{group}/contributions', [ContributionController::class, 'index']);
    Route::post('/groups/{group}/contributions', [ContributionController::class, 'store']);

    // Dashboard
    Route::get('/groups/{group}/dashboard', [DashboardController::class, 'show']);
});
