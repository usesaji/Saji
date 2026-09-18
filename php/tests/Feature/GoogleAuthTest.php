<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Socialite\Contracts\User as SocialiteUser;
use Laravel\Socialite\Facades\Socialite;
use Mockery;
use Tests\TestCase;

/**
 * Google sign-in callback: find-or-create, with the important edge case that an
 * account may already exist for the email (created via email signup). Google
 * must LINK onto it, not try to insert a duplicate.
 */
class GoogleAuthTest extends TestCase
{
    use RefreshDatabase;

    /** Point Socialite at a fake Google user for the callback. */
    private function fakeGoogleUser(string $id, string $email, string $name = 'Cheto'): void
    {
        $abstract = Mockery::mock(SocialiteUser::class);
        $abstract->shouldReceive('getId')->andReturn($id);
        $abstract->shouldReceive('getEmail')->andReturn($email);
        $abstract->shouldReceive('getName')->andReturn($name);
        $abstract->shouldReceive('getNickname')->andReturn(null);
        $abstract->shouldReceive('getAvatar')->andReturn('https://example.com/a.png');

        $provider = Mockery::mock('Laravel\Socialite\Two\GoogleProvider');
        $provider->shouldReceive('stateless')->andReturnSelf();
        $provider->shouldReceive('user')->andReturn($abstract);

        Socialite::shouldReceive('driver')->with('google')->andReturn($provider);
    }

    public function test_new_google_user_is_created_and_redirected_with_token(): void
    {
        $this->fakeGoogleUser('google-123', 'new@example.com');

        $response = $this->get('/api/auth/google/callback');

        $response->assertRedirect();
        $this->assertStringContainsString('/auth/google/callback?token=', $response->headers->get('Location'));

        $user = User::where('email', 'new@example.com')->first();
        $this->assertNotNull($user);
        $this->assertSame('google-123', $user->google_id);
        $this->assertNotNull($user->email_verified_at);
        // Avatar is upload-only: the Google profile photo must NOT be imported.
        $this->assertNull($user->avatar_url);
    }

    public function test_google_signin_does_not_overwrite_an_uploaded_avatar(): void
    {
        // A user who already uploaded their own picture.
        $existing = User::factory()->create([
            'email' => 'has-photo@example.com',
            'google_id' => null,
            'avatar_url' => '/storage/avatars/mine.png',
        ]);

        $this->fakeGoogleUser('google-555', 'has-photo@example.com');

        $this->get('/api/auth/google/callback')->assertRedirect();

        $existing->refresh();
        // Google linked, but the uploaded avatar is untouched (not replaced by
        // the Google photo).
        $this->assertSame('google-555', $existing->google_id);
        $this->assertSame('/storage/avatars/mine.png', $existing->avatar_url);
    }

    public function test_existing_email_account_is_linked_not_duplicated(): void
    {
        // An account created by email signup — no google_id yet.
        $existing = User::factory()->create([
            'email' => 'preizche@example.com',
            'google_id' => null,
        ]);

        $this->fakeGoogleUser('google-999', 'preizche@example.com');

        $response = $this->get('/api/auth/google/callback');

        $response->assertRedirect();
        // No duplicate row, and Google is now linked onto the existing account.
        $this->assertSame(1, User::where('email', 'preizche@example.com')->count());
        $existing->refresh();
        $this->assertSame('google-999', $existing->google_id);
    }

    public function test_returning_google_user_matches_by_google_id(): void
    {
        $existing = User::factory()->create([
            'email' => 'old@example.com',
            'google_id' => 'google-777',
        ]);

        // Same google_id, even if the email on the Google account differs.
        $this->fakeGoogleUser('google-777', 'old@example.com');

        $this->get('/api/auth/google/callback')->assertRedirect();

        $this->assertSame(1, User::where('google_id', 'google-777')->count());
        $this->assertSame($existing->id, User::where('google_id', 'google-777')->first()->id);
    }

    protected function tearDown(): void
    {
        Mockery::close();
        parent::tearDown();
    }
}
