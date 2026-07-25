<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Third Party Services
    |--------------------------------------------------------------------------
    |
    | This file is for storing the credentials for third party services such
    | as Mailgun, Postmark, AWS and more. This file provides the de facto
    | location for this type of information, allowing packages to have
    | a conventional file to locate the various service credentials.
    |
    */

    'postmark' => [
        'key' => env('POSTMARK_API_KEY'),
    ],

    'resend' => [
        'key' => env('RESEND_API_KEY'),
    ],

    'ses' => [
        'key' => env('AWS_ACCESS_KEY_ID'),
        'secret' => env('AWS_SECRET_ACCESS_KEY'),
        'region' => env('AWS_DEFAULT_REGION', 'us-east-1'),
    ],

    'slack' => [
        'notifications' => [
            'bot_user_oauth_token' => env('SLACK_BOT_USER_OAUTH_TOKEN'),
            'channel' => env('SLACK_BOT_USER_DEFAULT_CHANNEL'),
        ],
    ],

    'google' => [
        'client_id' => env('GOOGLE_CLIENT_ID'),
        'client_secret' => env('GOOGLE_CLIENT_SECRET'),
        'redirect' => env('GOOGLE_REDIRECT_URI'),
    ],

    'stellar' => [
        'network' => env('STELLAR_NETWORK', 'testnet'),
        'rpc_url' => env('STELLAR_RPC_URL', 'https://soroban-testnet.stellar.org'),
        'contract_id' => env('STELLAR_CONTRACT_ID'),
        // Path to the `stellar` CLI used to assemble/simulate invocations.
        'cli' => env('STELLAR_CLI', 'stellar'),
        // The backend scheduler's own key, used ONLY for trigger_payout (which
        // needs no user authority). Never a user's key. Leave unset to disable
        // backend-initiated payouts.
        'service_secret' => env('STELLAR_SERVICE_SECRET'),
        // Default token: the USDC Stellar Asset Contract (SAC) address on the
        // active network, used when a group doesn't specify its own asset.
        'usdc_sac' => env('STELLAR_USDC_SAC'),
        // Optional on-ramp link surfaced on the Wallet "Fund account" screen.
        'onramp_url' => env('STELLAR_ONRAMP_URL'),
    ],

];
