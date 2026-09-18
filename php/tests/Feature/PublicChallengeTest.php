<?php

namespace Tests\Feature;

use App\Models\ChallengeDeposit;
use App\Models\Group;
use App\Models\GroupMember;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * Public savings challenge — open, no pool, no rotation, no penalties. Each
 * member saves their own money toward a shared target. These tests also lock in
 * the boundary between challenge and rotating circles (each rejects the other's
 * money actions).
 */
class PublicChallengeTest extends TestCase
{
    use RefreshDatabase;

    private function challenge(User $creator, array $overrides = []): Group
    {
        $group = Group::create(array_merge([
            'name' => 'Save $500 Together',
            'organizer_id' => $creator->id,
            'asset_code' => 'USDC',
            'contribution_amount' => 0,
            'cycle_length_days' => 1,
            'contribution_frequency' => 'custom',
            'circle_kind' => 'challenge',
            'group_type' => 'public',
            'savings_target' => '500.0000000',
            'auto_approve_join' => true,
            'status' => 'open',
        ], $overrides));

        GroupMember::create([
            'group_id' => $group->id,
            'user_id' => $creator->id,
            'status' => 'approved',
            'joined_at' => now(),
        ]);

        return $group;
    }

    public function test_anyone_can_browse_and_create_public_challenges(): void
    {
        Sanctum::actingAs(User::factory()->create());

        $this->postJson('/api/challenges', [
            'name' => 'No-Spend November',
            'savings_target' => '300',
        ])->assertCreated()
            ->assertJson(['circle_kind' => 'challenge', 'group_type' => 'public', 'status' => 'open']);

        $this->getJson('/api/challenges')
            ->assertOk()
            ->assertJsonFragment(['name' => 'No-Spend November']);
    }

    public function test_a_user_can_join_a_public_challenge_instantly(): void
    {
        $creator = User::factory()->create();
        $group = $this->challenge($creator);

        Sanctum::actingAs(User::factory()->create());

        $this->postJson("/api/challenges/{$group->id}/join")
            ->assertCreated()
            ->assertJson(['status' => 'approved']); // open = instant approval
    }

    public function test_member_saves_toward_target_and_progress_reflects_confirmed(): void
    {
        $user = User::factory()->create();
        $group = $this->challenge($user);
        Sanctum::actingAs($user);

        // Record a save backed by an on-chain tx hash.
        $this->postJson("/api/challenges/{$group->id}/deposit", [
            'amount' => '120',
            'stellar_tx_hash' => 'HASH_SAVE_1',
        ])->assertCreated()->assertJson(['status' => 'pending']);

        // Pending doesn't count yet.
        $this->getJson("/api/challenges/{$group->id}/progress")
            ->assertOk()
            ->assertJson(['saved' => '0.0000000', 'percent' => 0]);

        // Once confirmed (as the indexer would), it counts toward the target.
        ChallengeDeposit::where('stellar_tx_hash', 'HASH_SAVE_1')
            ->update(['status' => 'confirmed', 'confirmed_at' => now()]);

        $this->getJson("/api/challenges/{$group->id}/progress")
            ->assertOk()
            ->assertJson([
                'saved' => '120.0000000',
                'target' => '500.0000000',
                'percent' => 24.0,
                'reached' => false,
            ]);
    }

    public function test_summary_leaderboard_ranks_members_by_saved(): void
    {
        $creator = User::factory()->create(['name' => 'Ada']);
        $group = $this->challenge($creator);
        $other = User::factory()->create(['name' => 'Ben']);
        GroupMember::create(['group_id' => $group->id, 'user_id' => $other->id, 'status' => 'approved', 'joined_at' => now()]);

        ChallengeDeposit::create(['group_id' => $group->id, 'user_id' => $creator->id, 'amount' => '100', 'stellar_tx_hash' => 'H1', 'status' => 'confirmed']);
        ChallengeDeposit::create(['group_id' => $group->id, 'user_id' => $other->id, 'amount' => '250', 'stellar_tx_hash' => 'H2', 'status' => 'confirmed']);

        Sanctum::actingAs($creator);

        $res = $this->getJson("/api/challenges/{$group->id}/summary")->assertOk();
        $res->assertJson([
            'group_saved_total' => '350.0000000',
            'member_count' => 2,
        ]);
        // Ben (250) ranks above Ada (100).
        $leaderboard = $res->json('leaderboard');
        $this->assertSame('Ben', $leaderboard[0]['name']);
        $this->assertSame('Ada', $leaderboard[1]['name']);
    }

    public function test_hide_balances_omits_the_leaderboard(): void
    {
        $creator = User::factory()->create();
        $group = $this->challenge($creator, ['hide_balances' => true]);
        Sanctum::actingAs($creator);

        $this->getJson("/api/challenges/{$group->id}/summary")
            ->assertOk()
            ->assertJson(['hide_balances' => true, 'leaderboard' => null]);
    }

    public function test_non_member_cannot_deposit(): void
    {
        $group = $this->challenge(User::factory()->create());
        Sanctum::actingAs(User::factory()->create()); // not a member

        $this->postJson("/api/challenges/{$group->id}/deposit", [
            'amount' => '50', 'stellar_tx_hash' => 'HX',
        ])->assertStatus(403);
    }

    // ---- Boundary: challenge vs rotating circle ----

    public function test_challenge_rejects_rotating_contribution_endpoint(): void
    {
        $user = User::factory()->create();
        $group = $this->challenge($user);
        Sanctum::actingAs($user);

        // The rotating contribute endpoint must refuse a challenge circle.
        $this->postJson("/api/groups/{$group->id}/contributions")
            ->assertStatus(422);
    }

    public function test_rotating_circle_rejects_challenge_deposit_endpoint(): void
    {
        $user = User::factory()->create();
        // A normal rotating group (default circle_kind).
        $group = Group::create([
            'name' => 'Ajo Circle',
            'organizer_id' => $user->id,
            'asset_code' => 'USDC',
            'contribution_amount' => '10',
            'cycle_length_days' => 7,
            'contribution_frequency' => 'weekly',
            'status' => 'active',
        ]);
        GroupMember::create(['group_id' => $group->id, 'user_id' => $user->id, 'status' => 'approved', 'joined_at' => now()]);
        Sanctum::actingAs($user);

        // The challenge deposit endpoint must refuse a rotating circle (404 —
        // it is not a challenge).
        $this->postJson("/api/challenges/{$group->id}/deposit", [
            'amount' => '10', 'stellar_tx_hash' => 'HR',
        ])->assertStatus(404);
    }
}
