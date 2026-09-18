<?php

namespace Tests\Feature;

use App\Models\Contribution;
use App\Models\Group;
use App\Models\GroupMember;
use App\Models\Payout;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * The home dashboard's headline figures.
 *
 * The money assertions here exist because a circle saves in exactly ONE token
 * chosen at creation, so a user in several circles can hold several different
 * currencies. Summing them into a single number adds unrelated units and then
 * labels the total as whichever asset we guessed — these tests pin the
 * per-asset breakdown so that can't come back.
 */
class UserDashboardTest extends TestCase
{
    use RefreshDatabase;

    /** A circle denominated in `$assetCode`, with `$user` as an approved member. */
    private function circleWith(User $user, string $assetCode): Group
    {
        $group = Group::create([
            'name' => "{$assetCode} Circle",
            'organizer_id' => $user->id,
            'asset_code' => $assetCode,
            'contribution_amount' => '100',
            'cycle_length_days' => 7,
            'contribution_frequency' => 'weekly',
            'status' => 'active',
        ]);

        GroupMember::create([
            'group_id' => $group->id,
            'user_id' => $user->id,
            'status' => 'approved',
            'joined_at' => now(),
        ]);

        return $group;
    }

    private function contribute(Group $g, User $u, string $amount): void
    {
        Contribution::create([
            'group_id' => $g->id,
            'user_id' => $u->id,
            'cycle' => 0,
            'amount' => $amount,
            'status' => 'confirmed',
        ]);
    }

    public function test_saved_balance_is_reported_per_asset_never_summed_across_them(): void
    {
        $user = User::factory()->create();
        $xlm = $this->circleWith($user, 'XLM');
        $usdc = $this->circleWith($user, 'USDC');
        $usdt = $this->circleWith($user, 'USDT');

        $this->contribute($xlm, $user, '100');
        $this->contribute($usdc, $user, '300');
        $this->contribute($usdt, $user, '200');

        Sanctum::actingAs($user);
        $res = $this->getJson('/api/dashboard')->assertOk();

        // Three currencies, three rows — NOT one "600" figure.
        $assets = $res->json('assets');
        $this->assertCount(3, $assets);

        // Largest first, and the headline mirrors it.
        $this->assertSame('USDC', $assets[0]['asset_code']);
        $this->assertSame('300.0000000', $assets[0]['saved']);
        $this->assertSame('USDT', $assets[1]['asset_code']);
        $this->assertSame('XLM', $assets[2]['asset_code']);

        $res->assertJson([
            'saved_balance' => '300.0000000',
            'asset_code' => 'USDC',
        ]);
    }

    public function test_a_payout_only_reduces_its_own_asset(): void
    {
        $user = User::factory()->create();
        $xlm = $this->circleWith($user, 'XLM');
        $usdc = $this->circleWith($user, 'USDC');

        $this->contribute($xlm, $user, '500');
        $this->contribute($usdc, $user, '400');

        // A USDC payout must not be subtracted from the XLM position — doing so
        // is how a cross-currency sum produces a nonsense (even negative) figure.
        Payout::create([
            'group_id' => $usdc->id,
            'recipient_id' => $user->id,
            'cycle' => 0,
            'gross_amount' => '400',
            'fee_amount' => '0',
            'net_amount' => '400',
            'status' => 'confirmed',
        ]);

        Sanctum::actingAs($user);
        $assets = $this->getJson('/api/dashboard')->assertOk()->json('assets');

        // USDC netted to zero and drops out; XLM is untouched.
        $this->assertCount(1, $assets);
        $this->assertSame('XLM', $assets[0]['asset_code']);
        $this->assertSame('500.0000000', $assets[0]['saved']);
    }

    public function test_pending_contributions_do_not_count(): void
    {
        $user = User::factory()->create();
        $group = $this->circleWith($user, 'USDC');

        Contribution::create([
            'group_id' => $group->id,
            'user_id' => $user->id,
            'cycle' => 0,
            'amount' => '250',
            'status' => 'pending', // not yet seen on-chain
        ]);

        Sanctum::actingAs($user);
        $this->getJson('/api/dashboard')
            ->assertOk()
            ->assertJson(['assets' => [], 'saved_balance' => '0.0000000']);
    }

    public function test_a_user_with_nothing_saved_gets_an_empty_breakdown(): void
    {
        Sanctum::actingAs(User::factory()->create());

        $this->getJson('/api/dashboard')
            ->assertOk()
            ->assertJson([
                'assets' => [],
                'saved_balance' => '0.0000000',
                'asset_code' => 'USDC', // sensible default, not a claim
                'people_total' => 0,
            ]);
    }

    public function test_people_total_counts_distinct_others_across_all_circles(): void
    {
        $user = User::factory()->create();
        $ada = User::factory()->create();
        $ben = User::factory()->create();

        $one = $this->circleWith($user, 'USDC');
        $two = $this->circleWith($user, 'XLM');

        // Ada is in BOTH circles — she must be counted once, not twice.
        foreach ([$one, $two] as $g) {
            GroupMember::create([
                'group_id' => $g->id,
                'user_id' => $ada->id,
                'status' => 'approved',
                'joined_at' => now(),
            ]);
        }
        GroupMember::create([
            'group_id' => $one->id,
            'user_id' => $ben->id,
            'status' => 'approved',
            'joined_at' => now(),
        ]);

        Sanctum::actingAs($user);

        // Ada + Ben = 2. The user themselves is excluded, so "+2 People" means
        // two OTHER people.
        $this->getJson('/api/dashboard')->assertOk()->assertJson(['people_total' => 2]);
    }

    public function test_a_solo_circle_reports_no_other_people(): void
    {
        $user = User::factory()->create();
        $this->circleWith($user, 'USDC');

        Sanctum::actingAs($user);
        $this->getJson('/api/dashboard')->assertOk()->assertJson(['people_total' => 0]);
    }
}
