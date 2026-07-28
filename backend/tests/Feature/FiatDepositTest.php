<?php

namespace Tests\Feature;

use App\Models\Transaction;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * SEP-24 fiat deposit flow, tested deterministically with a faked anchor —
 * no network, no real transaction. Every anchor HTTP call is stubbed via
 * Http::fake, and preventStrayRequests() makes any un-faked call fail loudly
 * so the tests can never silently reach the real network.
 */
class FiatDepositTest extends TestCase
{
    use RefreshDatabase;

    private const ANCHOR = 'anchor.test';

    protected function setUp(): void
    {
        parent::setUp();

        // Pin the anchor to a known domain so the fakes match discovery.
        config([
            'services.stellar.anchor_home_domain' => self::ANCHOR,
            'services.stellar.anchor_asset_code' => 'USDC',
        ]);

        Http::preventStrayRequests();
    }

    /** A user with a linked testnet wallet (deposits require one). */
    private function walletUser(): User
    {
        return User::factory()->create([
            'stellar_address' => 'GCUZ6YLL5RQBTYLTTQLPCM73C5XAIUGK2TIMWQH7HPSGWVS2KJ2F3CHS',
        ]);
    }

    /** Fake the anchor's stellar.toml (SEP-1 discovery). */
    private function fakeToml(): void
    {
        Http::fake([
            'https://'.self::ANCHOR.'/.well-known/stellar.toml' => Http::response(
                'NETWORK_PASSPHRASE="Test SDF Network ; September 2015"'."\n".
                'WEB_AUTH_ENDPOINT="https://'.self::ANCHOR.'/auth"'."\n".
                'TRANSFER_SERVER_SEP0024="https://'.self::ANCHOR.'/sep24"'."\n".
                'SIGNING_KEY="GCUZ6YLL5RQBTYLTTQLPCM73C5XAIUGK2TIMWQH7HPSGWVS2KJ2F3CHS"',
                200,
                ['Content-Type' => 'text/plain'],
            ),
        ]);
    }

    public function test_info_returns_anchor_details(): void
    {
        $this->fakeToml();
        Sanctum::actingAs($this->walletUser());

        $this->getJson('/api/fiat/deposit/info')
            ->assertOk()
            ->assertJson([
                'method' => 'sep24',
                'asset_code' => 'USDC',
                'anchor_home_domain' => self::ANCHOR,
                'wallet_linked' => true,
            ]);
    }

    public function test_challenge_returns_sep10_transaction_to_sign(): void
    {
        Http::fake([
            'https://'.self::ANCHOR.'/.well-known/stellar.toml' => Http::response(
                'WEB_AUTH_ENDPOINT="https://'.self::ANCHOR.'/auth"'."\n".
                'TRANSFER_SERVER_SEP0024="https://'.self::ANCHOR.'/sep24"', 200
            ),
            'https://'.self::ANCHOR.'/auth*' => Http::response([
                'transaction' => 'CHALLENGE_XDR',
                'network_passphrase' => 'Test SDF Network ; September 2015',
            ], 200),
        ]);
        Sanctum::actingAs($this->walletUser());

        $this->postJson('/api/fiat/deposit/challenge')
            ->assertOk()
            ->assertJson([
                'transaction' => 'CHALLENGE_XDR',
                'network_passphrase' => 'Test SDF Network ; September 2015',
            ]);
    }

    public function test_challenge_requires_a_linked_wallet(): void
    {
        $this->fakeToml();
        Sanctum::actingAs(User::factory()->create(['stellar_address' => null]));

        $this->postJson('/api/fiat/deposit/challenge')->assertStatus(422);
    }

    public function test_start_records_pending_deposit_and_returns_interactive_url(): void
    {
        Http::fake([
            'https://'.self::ANCHOR.'/.well-known/stellar.toml' => Http::response(
                'WEB_AUTH_ENDPOINT="https://'.self::ANCHOR.'/auth"'."\n".
                'TRANSFER_SERVER_SEP0024="https://'.self::ANCHOR.'/sep24"', 200
            ),
            // SEP-10 token exchange.
            'https://'.self::ANCHOR.'/auth' => Http::response(['token' => 'JWT_SESSION'], 200),
            // SEP-24 interactive deposit start.
            'https://'.self::ANCHOR.'/sep24/transactions/deposit/interactive' => Http::response([
                'url' => 'https://'.self::ANCHOR.'/interactive?id=abc123',
                'id' => 'abc123',
                'type' => 'interactive_customer_info_needed',
            ], 200),
        ]);

        $user = $this->walletUser();
        Sanctum::actingAs($user);

        $response = $this->postJson('/api/fiat/deposit/start', [
            'signed_challenge_xdr' => 'SIGNED_CHALLENGE_XDR',
            'amount' => '10',
        ]);

        $response->assertCreated()
            ->assertJson([
                'anchor_deposit_id' => 'abc123',
                'interactive_url' => 'https://'.self::ANCHOR.'/interactive?id=abc123',
                'session_token' => 'JWT_SESSION',
            ]);

        // A pending fiat-deposit transaction is recorded, tied to the user.
        $this->assertDatabaseHas('transactions', [
            'user_id' => $user->id,
            'status' => 'pending',
            'stellar_tx_hash' => 'sep24:abc123',
        ]);

        $tx = Transaction::where('stellar_tx_hash', 'sep24:abc123')->first();
        $this->assertSame('fiat_deposit', $tx->meta['kind']);
        $this->assertSame('abc123', $tx->meta['anchor_id']);
    }

    public function test_status_flips_pending_to_success_when_anchor_completes(): void
    {
        Http::fake([
            'https://'.self::ANCHOR.'/.well-known/stellar.toml' => Http::response(
                'WEB_AUTH_ENDPOINT="https://'.self::ANCHOR.'/auth"'."\n".
                'TRANSFER_SERVER_SEP0024="https://'.self::ANCHOR.'/sep24"', 200
            ),
            'https://'.self::ANCHOR.'/sep24/transaction*' => Http::response([
                'transaction' => [
                    'id' => 'abc123',
                    'status' => 'completed',
                    'amount_out' => '10.0000000',
                    'stellar_transaction_id' => 'STELLARHASH123',
                ],
            ], 200),
        ]);

        $user = $this->walletUser();
        $tx = Transaction::create([
            'user_id' => $user->id,
            'type' => 'other',
            'stellar_tx_hash' => 'sep24:abc123',
            'status' => 'pending',
            'meta' => ['kind' => 'fiat_deposit', 'anchor_id' => 'abc123'],
        ]);

        Sanctum::actingAs($user);

        $this->getJson("/api/fiat/deposit/{$tx->id}/status?session_token=JWT_SESSION")
            ->assertOk()
            ->assertJson([
                'anchor_status' => 'completed',
                'status' => 'success',
                'amount_out' => '10.0000000',
                'stellar_transaction_id' => 'STELLARHASH123',
            ]);

        // The settling on-chain hash + explorer link are stamped on success.
        $tx->refresh();
        $this->assertSame('success', $tx->status);
        $this->assertSame('STELLARHASH123', $tx->stellar_tx_hash);
        $this->assertNotNull($tx->explorer_url);
    }

    public function test_status_marks_failed_on_terminal_error(): void
    {
        Http::fake([
            'https://'.self::ANCHOR.'/.well-known/stellar.toml' => Http::response(
                'WEB_AUTH_ENDPOINT="https://'.self::ANCHOR.'/auth"'."\n".
                'TRANSFER_SERVER_SEP0024="https://'.self::ANCHOR.'/sep24"', 200
            ),
            'https://'.self::ANCHOR.'/sep24/transaction*' => Http::response([
                'transaction' => ['id' => 'abc123', 'status' => 'error'],
            ], 200),
        ]);

        $user = $this->walletUser();
        $tx = Transaction::create([
            'user_id' => $user->id,
            'type' => 'other',
            'stellar_tx_hash' => 'sep24:abc123',
            'status' => 'pending',
            'meta' => ['kind' => 'fiat_deposit', 'anchor_id' => 'abc123'],
        ]);

        Sanctum::actingAs($user);

        $this->getJson("/api/fiat/deposit/{$tx->id}/status?session_token=JWT_SESSION")
            ->assertOk()
            ->assertJson(['anchor_status' => 'error', 'status' => 'failed']);

        $this->assertSame('failed', $tx->fresh()->status);
    }

    public function test_status_is_scoped_to_the_owner(): void
    {
        $owner = $this->walletUser();
        $tx = Transaction::create([
            'user_id' => $owner->id,
            'type' => 'other',
            'stellar_tx_hash' => 'sep24:abc123',
            'status' => 'pending',
            'meta' => ['kind' => 'fiat_deposit', 'anchor_id' => 'abc123'],
        ]);

        // A different user must not be able to poll someone else's deposit.
        Sanctum::actingAs(User::factory()->create());

        $this->getJson("/api/fiat/deposit/{$tx->id}/status?session_token=JWT_SESSION")
            ->assertNotFound();
    }
}
