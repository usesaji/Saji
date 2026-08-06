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
        // No testnet defaults: a missing var on a mainnet host must fail loudly,
        // not silently produce a testnet-configured app handling real money.
        'network' => env('STELLAR_NETWORK'),
        'rpc_url' => env('STELLAR_RPC_URL'),
        'contract_id' => env('STELLAR_CONTRACT_ID'),
        // Path to the `stellar` CLI used to assemble/simulate invocations.
        'cli' => env('STELLAR_CLI', 'stellar'),
        // PUBLIC address (G...) used as the source for read-only simulations.
        // Must never be a secret: CLI args are visible to other local processes.
        'read_source' => env('STELLAR_READ_SOURCE'),
        // The backend scheduler's own key, used ONLY for trigger_payout (which
        // needs no user authority). Never a user's key. Leave unset to disable
        // backend-initiated payouts.
        'service_secret' => env('STELLAR_SERVICE_SECRET'),
        // Default token: the USDC Stellar Asset Contract (SAC) address on the
        // active network, used when a group doesn't specify its own asset.
        'usdc_sac' => env('STELLAR_USDC_SAC'),
        // Supported pool tokens, keyed by asset code → SAC address. A group
        // saves in exactly one of these; this must stay in sync with the
        // frontend's src/lib/contract/tokens.ts.
        'token_sacs' => array_filter([
            'USDC' => env('STELLAR_USDC_SAC'),
            'USDT' => env('STELLAR_USDT_SAC'),
            'XLM' => env('STELLAR_XLM_SAC'),
        ]),
    ],

];
