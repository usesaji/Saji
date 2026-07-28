<?php

namespace App\Services\Stellar;

use Illuminate\Support\Facades\Http;
use RuntimeException;

/**
 * Stellar SEP-24 interactive deposit — the fiat "Add money" path.
 *
 * NON-CUSTODIAL: the anchor delivers USDC to the user's OWN Stellar wallet.
 * Saji never holds funds or keys, and the SEP-10 auth challenge is signed by
 * the USER'S connected wallet (not the backend). This service does the parts
 * that don't require the user's key:
 *
 *   1. discover()        SEP-1  — read the anchor's stellar.toml for its
 *                                 auth + transfer endpoints and asset info.
 *   2. authChallenge()   SEP-10 — fetch the challenge transaction (the wallet
 *                                 signs it client-side).
 *   3. authToken()       SEP-10 — exchange the wallet-signed challenge for a JWT.
 *   4. startDeposit()    SEP-24 — begin an interactive deposit; returns the
 *                                 anchor URL the user opens to pay fiat + KYC.
 *   5. transaction()     SEP-24 — poll a deposit's status until USDC lands.
 *
 * A fiat deposit only counts once the anchor reports it `completed` and the
 * USDC is on-chain — pending fiat is never treated as available funds.
 */
class Sep24Service
{
    private string $homeDomain;
    private string $assetCode;

    public function __construct()
    {
        $this->homeDomain = (string) config('services.stellar.anchor_home_domain');
        $this->assetCode = (string) config('services.stellar.anchor_asset_code', 'USDC');
    }

    /**
     * SEP-1: read the anchor's stellar.toml and pull the endpoints we need.
     *
     * @return array{web_auth_endpoint:string,transfer_server_sep0024:string,signing_key:?string,home_domain:string,asset_code:string}
     */
    public function discover(): array
    {
        $tomlUrl = "https://{$this->homeDomain}/.well-known/stellar.toml";

        $response = Http::acceptJson()->timeout(20)->get($tomlUrl);
        if (! $response->successful()) {
            throw new RuntimeException("Could not read anchor stellar.toml at {$tomlUrl}.");
        }

        $toml = $this->parseToml($response->body());

        $webAuth = $toml['WEB_AUTH_ENDPOINT'] ?? null;
        $transfer = $toml['TRANSFER_SERVER_SEP0024'] ?? ($toml['TRANSFER_SERVER'] ?? null);

        if (! $webAuth || ! $transfer) {
            throw new RuntimeException('Anchor stellar.toml is missing SEP-10/SEP-24 endpoints.');
        }

        return [
            'web_auth_endpoint' => rtrim($webAuth, '/'),
            'transfer_server_sep0024' => rtrim($transfer, '/'),
            'signing_key' => $toml['SIGNING_KEY'] ?? null,
            'home_domain' => $this->homeDomain,
            'asset_code' => $this->assetCode,
        ];
    }

    /**
     * SEP-10 step 1: fetch the challenge transaction for a given account. The
     * caller's wallet signs the returned `transaction` XDR and passes it to
     * authToken(). Returns the challenge XDR (+ network passphrase for signing).
     *
     * @return array{transaction:string,network_passphrase:?string}
     */
    public function authChallenge(string $account): array
    {
        $endpoint = $this->discover()['web_auth_endpoint'];

        $response = Http::acceptJson()->timeout(20)->get($endpoint, [
            'account' => $account,
            'home_domain' => $this->homeDomain,
        ]);

        if (! $response->successful()) {
            throw new RuntimeException('Anchor rejected the SEP-10 challenge request: '.$response->body());
        }

        $body = $response->json();

        return [
            'transaction' => $body['transaction'] ?? '',
            'network_passphrase' => $body['network_passphrase'] ?? null,
        ];
    }

    /**
     * SEP-10 step 2: exchange the WALLET-SIGNED challenge XDR for a session JWT.
     * The token authenticates subsequent SEP-24 calls for that account.
     */
    public function authToken(string $signedChallengeXdr): string
    {
        $endpoint = $this->discover()['web_auth_endpoint'];

        $response = Http::asJson()->acceptJson()->timeout(20)->post($endpoint, [
            'transaction' => $signedChallengeXdr,
        ]);

        if (! $response->successful()) {
            throw new RuntimeException('SEP-10 token exchange failed: '.$response->body());
        }

        $token = $response->json('token');
        if (! $token) {
            throw new RuntimeException('Anchor did not return a SEP-10 token.');
        }

        return $token;
    }

    /**
     * SEP-24: start an interactive deposit. Returns the anchor's interactive
     * URL (the user opens it to pay fiat + complete KYC) and the anchor's
     * transaction id to poll. `token` is the SEP-10 JWT from authToken().
     *
     * @return array{url:string,id:string,type:string}
     */
    public function startDeposit(string $token, string $account, ?string $amount = null): array
    {
        $endpoint = $this->discover()['transfer_server_sep0024'];

        $payload = array_filter([
            'asset_code' => $this->assetCode,
            'account' => $account,
            'amount' => $amount,
        ], fn ($v) => $v !== null);

        $response = Http::asJson()->acceptJson()
            ->withToken($token)
            ->timeout(30)
            ->post("{$endpoint}/transactions/deposit/interactive", $payload);

        if (! $response->successful()) {
            throw new RuntimeException('Anchor rejected the SEP-24 deposit start: '.$response->body());
        }

        $body = $response->json();

        return [
            'url' => $body['url'] ?? '',
            'id' => $body['id'] ?? '',
            'type' => $body['type'] ?? 'interactive_customer_info_needed',
        ];
    }

    /**
     * SEP-24: fetch a single deposit transaction's current status. Poll this
     * until `status === 'completed'` (USDC delivered) or a terminal error.
     *
     * @return array{id:string,status:string,amount_out:?string,stellar_transaction_id:?string,raw:array}
     */
    public function transaction(string $token, string $id): array
    {
        $endpoint = $this->discover()['transfer_server_sep0024'];

        $response = Http::acceptJson()
            ->withToken($token)
            ->timeout(20)
            ->get("{$endpoint}/transaction", ['id' => $id]);

        if (! $response->successful()) {
            throw new RuntimeException('Could not read SEP-24 transaction status: '.$response->body());
        }

        $tx = $response->json('transaction') ?? [];

        return [
            'id' => $tx['id'] ?? $id,
            'status' => $tx['status'] ?? 'unknown',
            'amount_out' => $tx['amount_out'] ?? null,
            'stellar_transaction_id' => $tx['stellar_transaction_id'] ?? null,
            'raw' => $tx,
        ];
    }

    /**
     * Minimal stellar.toml parser: TOML is a superset we don't fully need, so
     * we extract the flat top-level `KEY = "value"` pairs the SEP specs put at
     * the document root (endpoints + signing key), ignoring tables/arrays.
     *
     * @return array<string,string>
     */
    private function parseToml(string $body): array
    {
        $out = [];
        foreach (preg_split('/\r\n|\r|\n/', $body) as $line) {
            $line = trim($line);
            // Stop at the first table header — root keys come before tables.
            if (str_starts_with($line, '[')) {
                break;
            }
            if ($line === '' || str_starts_with($line, '#')) {
                continue;
            }
            if (preg_match('/^([A-Z0-9_]+)\s*=\s*"([^"]*)"/i', $line, $m)) {
                $out[strtoupper($m[1])] = $m[2];
            }
        }

        return $out;
    }
}
