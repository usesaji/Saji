<?php

namespace App\Services\Stellar;

use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Process;
use RuntimeException;

/**
 * Thin seam over Stellar / Soroban. Every place the backend touches the chain
 * goes through here.
 *
 * Saji is NON-CUSTODIAL: the backend never holds a user's private key. Money
 * actions are signed by the user's connected wallet. This service's job is to
 * BUILD unsigned transactions (XDR) for the frontend to sign, and to SUBMIT the
 * signed result / read on-chain state — never to sign on a user's behalf.
 *
 * How each responsibility is fulfilled:
 *  - READS + SUBMIT  -> Soroban JSON-RPC over HTTP (self-contained, no SDK).
 *  - BUILD unsigned  -> the `stellar` CLI assembles + simulates the invocation
 *    transaction and prints base64 XDR. The CLI is the documented toolchain
 *    (see SPEC.md §9); this class is the single seam, so a native PHP Stellar
 *    SDK can later replace the CLI calls without changing any caller.
 *
 * The read/scVal decoding here targets the Saji contract's own return shapes
 * (i128 pool, u32 cycle, Address recipient); it is not a general XDR codec.
 */
class StellarService
{
    private string $rpcUrl;
    private string $contractId;
    private string $network;
    private string $networkPassphrase;

    /** Canonical network passphrases (the CLI needs these explicitly). */
    private const PASSPHRASES = [
        'testnet' => 'Test SDF Network ; September 2015',
        'public' => 'Public Global Stellar Network ; September 2015',
        'futurenet' => 'Test SDF Future Network ; October 2022',
    ];

    public function __construct()
    {
        $this->rpcUrl = (string) config('services.stellar.rpc_url');
        $this->contractId = (string) config('services.stellar.contract_id');
        $this->network = (string) config('services.stellar.network', 'testnet');
        // The `stellar` CLI's `--network <alias>` only works when that alias is
        // configured on the host. To be self-contained we pass the passphrase +
        // RPC URL via env (see stellar()), which the CLI honors without setup.
        $this->networkPassphrase = (string) (
            config('services.stellar.network_passphrase')
                ?: (self::PASSPHRASES[$this->network] ?? self::PASSPHRASES['testnet'])
        );
    }

    /** Build a Stellar explorer link for a tx hash. */
    public function explorerUrl(string $txHash): string
    {
        return "https://stellar.expert/explorer/{$this->network}/tx/{$txHash}";
    }

    // ------------------------------------------------------------------
    // Build unsigned transactions (XDR) — wallet signs these client-side.
    // Each returns base64 transaction-envelope XDR ready for the frontend
    // to hand to the connected wallet (Freighter / passkey) for signing.
    // ------------------------------------------------------------------

    /** Organizer signs. Creates a group; returns unsigned XDR. */
    public function buildCreateGroupTx(
        string $organizer,
        string $token,
        int $amount,
        int $cycleLength,
        int $feeBps,
        int $lateFeeBps = 0,
        int $gracePeriod = 0,
        string $payoutOrder = 'Manual',
        string $latePenalty = 'DeductFromBalance',
    ): string {
        return $this->buildInvoke($organizer, 'create_group', [
            'organizer' => $organizer,
            'token' => $token,
            'amount' => (string) $amount,
            'cycle_length' => (string) $cycleLength,
            'fee_bps' => (string) $feeBps,
            'late_fee_bps' => (string) $lateFeeBps,
            'grace_period' => (string) $gracePeriod,
            // Soroban enum args are passed by their variant name.
            'payout_order' => $payoutOrder,
            'late_penalty' => $latePenalty,
        ]);
    }

    /**
     * Organizer signs. Sets the exact manual payout order (drag-and-drop "who
     * gets paid first"). `order` is the ordered list of member addresses; the
     * contract validates it is a permutation of the current members.
     *
     * @param  array<int,string>  $order  member addresses, first-paid first
     */
    public function buildSetPayoutOrderTx(string $organizer, int $groupId, array $order): string
    {
        // The CLI takes a Vec<Address> arg as a JSON array of addresses.
        return $this->buildInvoke($organizer, 'set_payout_order', [
            'group_id' => (string) $groupId,
            'order' => json_encode(array_values($order)),
        ]);
    }

    /** Organizer signs. Admits a member; returns unsigned XDR. */
    public function buildJoinGroupTx(string $organizer, int $groupId, string $member): string
    {
        return $this->buildInvoke($organizer, 'join_group', [
            'group_id' => (string) $groupId,
            'member' => $member,
        ]);
    }

    /** Organizer signs. Locks rotation and starts cycle 0; returns unsigned XDR. */
    public function buildStartCycleTx(string $organizer, int $groupId): string
    {
        return $this->buildInvoke($organizer, 'start_cycle', [
            'group_id' => (string) $groupId,
        ]);
    }

    /** Member's connected wallet signs. Contributes the fixed amount; unsigned XDR. */
    public function buildContributeTx(string $member, int $groupId): string
    {
        return $this->buildInvoke($member, 'contribute', [
            'group_id' => (string) $groupId,
            'member' => $member,
        ]);
    }

    // ------------------------------------------------------------------
    // Submit + payout
    // ------------------------------------------------------------------

    /**
     * Broadcast a wallet-signed transaction envelope (base64 XDR) to the
     * network via Soroban RPC `sendTransaction`. Returns the RPC result
     * (includes the tx hash and status) for the caller to persist.
     *
     * @return array{hash:string,status:string,raw:array}
     */
    public function submitSigned(string $signedXdr): array
    {
        $res = $this->rpc('sendTransaction', ['transaction' => $signedXdr]);

        $hash = $res['hash'] ?? '';
        $status = $res['status'] ?? 'ERROR';

        if ($status === 'ERROR') {
            throw new RuntimeException('Soroban rejected the transaction: '.json_encode($res));
        }

        return ['hash' => $hash, 'status' => $status, 'raw' => $res];
    }

    /**
     * Poll `getTransaction` until the network reports a final status
     * (SUCCESS / FAILED) or the attempt budget is exhausted.
     *
     * @return array{status:string,raw:array}
     */
    public function awaitConfirmation(string $hash, int $tries = 10, int $sleepMs = 1500): array
    {
        for ($i = 0; $i < $tries; $i++) {
            $res = $this->rpc('getTransaction', ['hash' => $hash]);
            $status = $res['status'] ?? 'NOT_FOUND';

            if (in_array($status, ['SUCCESS', 'FAILED'], true)) {
                return ['status' => $status, 'raw' => $res];
            }

            usleep($sleepMs * 1000);
        }

        return ['status' => 'PENDING', 'raw' => []];
    }

    /**
     * One non-blocking status check for a tx hash. Returns SUCCESS / FAILED /
     * NOT_FOUND (still pending or unknown). Used by the indexer to finalize
     * pending transaction rows without polling.
     */
    public function getTransactionStatus(string $hash): string
    {
        $res = $this->rpc('getTransaction', ['hash' => $hash]);

        return $res['status'] ?? 'NOT_FOUND';
    }

    /**
     * Trigger the current cycle's payout. `trigger_payout` needs no user
     * authority (it can only pay the rules-determined recipient), so the
     * backend scheduler signs with its own service account and submits.
     * Returns the tx hash.
     *
     * Requires STELLAR_SERVICE_SECRET (the scheduler's key). Absent it, this
     * throws — the backend should never fabricate authority it doesn't have.
     */
    public function triggerPayout(int $groupId): string
    {
        $secret = (string) config('services.stellar.service_secret');
        if ($secret === '') {
            throw new RuntimeException('STELLAR_SERVICE_SECRET is not configured; cannot trigger payout.');
        }

        // The CLI signs + submits in one step for the service-authorized call.
        $out = $this->stellar([
            'contract', 'invoke',
            '--id', $this->contractId,
            '--source-account', $secret,
            '--network', $this->network,
            '--send', 'yes',
            '--', 'trigger_payout',
            '--group_id', (string) $groupId,
        ]);

        // The CLI prints the tx hash on success.
        return trim($out);
    }

    // ------------------------------------------------------------------
    // Reads (dashboard / indexer) — Soroban RPC simulate, decoded for our
    // contract's known return shapes.
    // ------------------------------------------------------------------

    /** Current pooled balance for a group (i128, in stroops/7-dp units). */
    public function getPool(int $groupId): int
    {
        return (int) $this->readScalar('get_pool', ['group_id' => (string) $groupId]);
    }

    /** Current 0-based cycle index for a group. */
    public function getCycle(int $groupId): int
    {
        return (int) $this->readScalar('get_cycle', ['group_id' => (string) $groupId]);
    }

    /** The address that will receive the current cycle's payout. */
    public function nextRecipient(int $groupId): string
    {
        return (string) $this->readScalar('next_recipient', ['group_id' => (string) $groupId]);
    }

    /**
     * The on-chain group config as an associative array (status, member_count,
     * amount, token, …). Used by the indexer to reconcile DB status with the
     * contract. `status` is the numeric Status enum: 0=Draft,1=Open,2=Active,
     * 3=Completed.
     *
     * @return array<string,mixed>
     */
    public function getGroupState(int $groupId): array
    {
        $json = $this->readJson('get_group', ['group_id' => (string) $groupId]);
        $data = json_decode($json, true);

        return is_array($data) ? $data : [];
    }

    /**
     * The on-chain member address list for a group, in payout order.
     *
     * @return array<int,string>
     */
    public function getMembers(int $groupId): array
    {
        $json = $this->readJson('get_members', ['group_id' => (string) $groupId]);
        $data = json_decode($json, true);

        return is_array($data) ? array_values($data) : [];
    }

    /** Has `member` already paid for `cycle` in this group? */
    public function hasContributed(int $groupId, int $cycle, string $member): bool
    {
        $val = $this->readScalar('has_contributed', [
            'group_id' => (string) $groupId,
            'cycle' => (string) $cycle,
            'member' => $member,
        ]);

        return $val === 'true' || $val === '1';
    }

    /** Whether a member has been removed (defaulted) from the rotation. */
    public function isRemoved(int $groupId, string $member): bool
    {
        $val = $this->readScalar('is_removed', [
            'group_id' => (string) $groupId,
            'member' => $member,
        ]);

        return $val === 'true' || $val === '1';
    }

    /** Accrued late-fee debt (stroops) for a member, netted from their payout. */
    public function lateFeeOf(int $groupId, string $member): int
    {
        $val = $this->readScalar('late_fee_of', [
            'group_id' => (string) $groupId,
            'member' => $member,
        ]);

        return (int) ($val === '' ? '0' : $val);
    }

    /**
     * Amount (stroops) a member is owed and can claim from a group — their
     * completed-cycle payout sitting escrowed in the contract. 0 = nothing to
     * claim. Backs the "Saji balance" (sum across the user's circles).
     */
    public function claimableOf(int $groupId, string $member): int
    {
        $val = $this->readScalar('claimable_of', [
            'group_id' => (string) $groupId,
            'member' => $member,
        ]);

        return (int) ($val === '' ? '0' : $val);
    }

    // ------------------------------------------------------------------
    // Wallet (non-custodial): read the user's OWN on-chain balance and build
    // an unsigned withdrawal payment their wallet signs. The backend never
    // holds the key or the funds.
    // ------------------------------------------------------------------

    /**
     * The token balance of an arbitrary account, read from the token contract's
     * `balance` view. Used for the Wallet page's "amount" (the user's own
     * spendable balance) — a read of the chain, not a custodial ledger.
     *
     * Returns the raw i128 in stroops (7-dp). Defaults to the group/default
     * USDC SAC when no token is given.
     */
    public function balanceOf(string $account, ?string $token = null): int
    {
        $token ??= (string) config('services.stellar.usdc_sac');
        if ($token === '') {
            throw new RuntimeException('No token address configured to read a balance.');
        }

        // A read still requires a --source-account for the CLI (it simulates the
        // invocation). For a balance query the account being read is a fine
        // source — nothing is signed or submitted (--send no).
        $cmd = [
            'contract', 'invoke',
            '--id', $token,
            '--source-account', $account,
            '--network', $this->network,
            '--send', 'no',
            '--', 'balance',
            '--id', $account,
        ];

        return (int) trim($this->stellar($cmd), " \n\r\t\"");
    }

    /**
     * Build an unsigned token-payment transaction moving `amount` (stroops)
     * from the user's wallet to a destination — the Wallet "Withdraw" action.
     * The user's connected wallet signs it; the backend only assembles it.
     */
    public function buildWithdrawTx(string $from, string $to, int $amount, ?string $token = null): string
    {
        $token ??= (string) config('services.stellar.usdc_sac');
        if ($token === '') {
            throw new RuntimeException('No token address configured for withdrawal.');
        }
        if ($amount <= 0) {
            throw new RuntimeException('Withdrawal amount must be positive.');
        }

        // No savings-contract id needed here — a withdrawal is a plain token
        // transfer against the token contract, so we only require the token.
        $cmd = [
            'contract', 'invoke',
            '--id', $token,
            '--source-account', $from,
            '--network', $this->network,
            '--build-only',
            '--', 'transfer',
            '--from', $from,
            '--to', $to,
            '--amount', (string) $amount,
        ];

        return trim($this->stellar($cmd));
    }

    // ------------------------------------------------------------------
    // Internals
    // ------------------------------------------------------------------

    /**
     * Build an unsigned invocation via the CLI's `--build-only`, which
     * assembles and simulates the transaction and prints base64 XDR without
     * signing. The wallet signs it client-side.
     *
     * @param  array<string,string>  $args  contract args as name => value,
     *         matching the contract's own parameter names (see SPEC.md §4).
     */
    private function buildInvoke(string $sourceAccount, string $function, array $args): string
    {
        $this->assertConfigured();

        $cmd = [
            'contract', 'invoke',
            '--id', $this->contractId,
            '--source-account', $sourceAccount,
            '--network', $this->network,
            '--build-only',
            '--', $function,
        ];

        foreach ($args as $name => $value) {
            $cmd[] = '--'.$name;
            $cmd[] = $value;
        }

        return trim($this->stellar($cmd));
    }

    /**
     * Simulate a read-only view and return its decoded scalar. Uses the CLI
     * in read mode (no signing, no submit) so views never need a funded key.
     *
     * @param  array<string,string>  $args  name => value contract args
     */
    private function readScalar(string $function, array $args): string
    {
        $this->assertConfigured();

        $cmd = [
            'contract', 'invoke',
            '--id', $this->contractId,
            '--source-account', $this->readSource(),
            '--network', $this->network,
            '--send', 'no',
            '--', $function,
        ];

        foreach ($args as $name => $value) {
            $cmd[] = '--'.$name;
            $cmd[] = $value;
        }

        // The CLI prints the return value as JSON (e.g. "123", "\"GABC...\"").
        return trim($this->stellar($cmd), " \n\r\t\"");
    }

    /**
     * Like readScalar but returns the raw JSON output (unstripped), for reads
     * whose return value is a struct or array (e.g. get_group, get_members).
     *
     * @param  array<string,string>  $args
     */
    private function readJson(string $function, array $args): string
    {
        $this->assertConfigured();

        $cmd = [
            'contract', 'invoke',
            '--id', $this->contractId,
            '--source-account', $this->readSource(),
            '--network', $this->network,
            '--send', 'no',
            '--', $function,
        ];

        foreach ($args as $name => $value) {
            $cmd[] = '--'.$name;
            $cmd[] = $value;
        }

        return trim($this->stellar($cmd));
    }

    /**
     * A source account for read-only (`--send no`) contract simulations. The CLI
     * requires one even though nothing is signed or submitted. The service secret
     * works and needs no per-request user; the read reveals nothing about it.
     */
    private function readSource(): string
    {
        $secret = (string) config('services.stellar.service_secret');
        if ($secret === '') {
            throw new RuntimeException('No STELLAR_SERVICE_SECRET set for read simulations.');
        }

        return $secret;
    }

    /** Low-level Soroban JSON-RPC call over HTTP. Returns the `result` object. */
    private function rpc(string $method, array $params): array
    {
        $response = Http::acceptJson()
            ->timeout(30)
            ->post($this->rpcUrl, [
                'jsonrpc' => '2.0',
                'id' => 1,
                'method' => $method,
                'params' => $params,
            ]);

        $body = $response->json();

        if (isset($body['error'])) {
            throw new RuntimeException("Soroban RPC {$method} error: ".json_encode($body['error']));
        }

        return $body['result'] ?? [];
    }

    /**
     * Run the `stellar` CLI. Isolated here so the process boundary — and the
     * eventual swap to a native PHP SDK — lives in exactly one place.
     */
    private function stellar(array $args): string
    {
        $binary = (string) config('services.stellar.cli', 'stellar');

        // Provide network config as CLI flags so the tool doesn't require a
        // locally configured `--network` alias, and so we don't have to replace
        // the process environment (which on some hosts drops the system PATH/DNS
        // resolver config and breaks outbound RPC). We inject the flags right
        // after the sub-command for any `contract` invocation.
        $args = $this->withNetworkFlags($args);

        $result = Process::timeout(120)->run(array_merge([$binary], $args));

        if (! $result->successful()) {
            throw new RuntimeException(
                'stellar CLI failed: '.trim($result->errorOutput() ?: $result->output())
            );
        }

        return $result->output();
    }

    /**
     * Replace any `--network <alias>` with explicit `--rpc-url` +
     * `--network-passphrase` flags. This keeps the CLI self-contained (no host
     * alias config required) while leaving the real process environment — and
     * thus PATH/DNS resolution for the outbound RPC — untouched.
     *
     * @param  array<int,string>  $args
     * @return array<int,string>
     */
    private function withNetworkFlags(array $args): array
    {
        $out = [];
        for ($i = 0; $i < count($args); $i++) {
            // Drop the `--network <alias>` pair; we supply passphrase + rpc below.
            if ($args[$i] === '--network') {
                $i++; // also skip its value

                continue;
            }
            $out[] = $args[$i];
        }

        // Only network-bound sub-commands (contract invoke, etc.) take these.
        if (($out[0] ?? null) === 'contract') {
            array_splice($out, 2, 0, [
                '--rpc-url', $this->rpcUrl,
                '--network-passphrase', $this->networkPassphrase,
            ]);
        }

        return $out;
    }

    private function assertConfigured(): void
    {
        if ($this->contractId === '') {
            throw new RuntimeException('STELLAR_CONTRACT_ID is not set; deploy the contract first.');
        }
    }
}
