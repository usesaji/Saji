# Deploying the Saji backend on aaPanel — detailed guide

Click-by-click instructions for putting the Laravel backend on an aaPanel VPS,
with the Next.js frontend staying on Vercel.

```
Next.js frontend  →  Vercel        (https://your-app.vercel.app)
Laravel backend   →  aaPanel VPS   (https://api.yourdomain.com)
```

The frontend reaches the backend purely through `NEXT_PUBLIC_API_URL`
(`src/lib/api/index.ts:13`), so no code changes are needed — only configuration.

Substitute throughout:

| Placeholder           | Meaning                                  |
| --------------------- | ---------------------------------------- |
| `api.yourdomain.com`  | domain serving this Laravel backend      |
| `your-app.vercel.app` | deployed Next.js frontend origin         |
| `<VPS_IP>`            | your server's public IP                  |
| `/www/wwwroot/saji`   | where you clone the repo                 |

The Laravel app root is `/www/wwwroot/saji/backend`.

---

## Contents

- [What makes this app need a real server](#what-makes-this-app-need-a-real-server)
- [Prerequisites](#prerequisites)
- [Step 1 — Install the stack](#step-1--install-the-stack)
- [Step 2 — Re-enable disabled PHP functions](#step-2--re-enable-disabled-php-functions)
- [Step 3 — Install the Stellar CLI](#step-3--install-the-stellar-cli)
- [Step 4 — Point the domain at the VPS](#step-4--point-the-domain-at-the-vps)
- [Step 5 — Create the site and set the document root](#step-5--create-the-site-and-set-the-document-root)
- [Step 6 — Clone and install dependencies](#step-6--clone-and-install-dependencies)
- [Step 7 — Create the database](#step-7--create-the-database)
- [Step 8 — Configure `.env`](#step-8--configure-env)
- [Step 9 — Permissions, migrations, caches](#step-9--permissions-migrations-caches)
- [Step 10 — Run the scheduler](#step-10--run-the-scheduler)
- [Step 11 — Enable SSL](#step-11--enable-ssl)
- [Step 12 — Google OAuth and email](#step-12--google-oauth-and-email)
- [Step 13 — Connect the frontend](#step-13--connect-the-frontend)
- [Step 14 — Testnet exposure](#step-14--testnet-exposure)
- [Verification checklist](#verification-checklist)
- [Troubleshooting](#troubleshooting)
- [Redeploying](#redeploying)

---

## What makes this app need a real server

Four requirements rule out shared hosting and serverless. aaPanel on your own
VPS meets all four, but each needs deliberate setup:

1. **It shells out to the `stellar` Rust binary.**
   `app/Services/Stellar/StellarService.php:549` runs `Process::run([$binary, …])`.
   Six call sites depend on it; every on-chain write goes through it.
   → Steps 2, 3.
2. **A 30-second scheduled chain indexer.**
   `routes/console.php` registers `chain:index` on `everyThirtySeconds()`.
   Without it, contributions stay pending and the activity feed stays empty.
   → Step 10.
3. **Detached background processes.**
   `app/Http/Controllers/Concerns/SpawnsChainReconcile.php:26-29` uses `exec(… &)`
   for the fast reconcile path.
   → Step 2.
4. **A persistent filesystem and database.**
   SQLite locally, `database`-backed session/cache/queue, local-disk uploads for
   group photos and avatars.
   → Steps 7, 9.

---

## Prerequisites

- A VPS with aaPanel installed and **root SSH access**
- A domain or subdomain you control
- The repo accessible from the VPS (public URL, deploy key, or PAT)
- Your local `backend/.env` open for reference — you will copy the `STELLAR_*`,
  `GOOGLE_*`, and `RESEND_API_KEY` values across

> **Handling secrets.** `backend/.env` contains `STELLAR_SERVICE_SECRET`,
> `GOOGLE_CLIENT_SECRET`, and `RESEND_API_KEY`. Type or paste them directly into
> the server file over SSH. Do not commit them, do not paste them into chat
> tools, and do not email them to yourself.

---

## Step 1 — Install the stack

aaPanel → **App Store**. Install:

- **Nginx** (any recent version)
- **PHP 8.3** — required. `composer.json` declares `"php": "^8.3"` and Laravel 13.
  PHP 8.2 or lower will refuse to install dependencies.
- **MySQL 8.0**

Then enable the PHP extensions. **App Store → PHP 8.3 → Setting → Install
extensions**, and confirm all of these are present:

```
ctype  dom  fileinfo  filter  hash  iconv  json  libxml
mbstring  openssl  pcre  phar  session  tokenizer  xml  xmlwriter
```

`fileinfo` is the one most often disabled by default, and file uploads fail
without it.

Verify over SSH:

```bash
php -v                      # expect 8.3.x
php -m | grep -E 'fileinfo|mbstring|openssl|dom|tokenizer'
```

If `php -v` shows the wrong version, aaPanel installs PHP under
`/www/server/php/83/bin/php`. Note that path — you may need it in Step 10.

---

## Step 2 — Re-enable disabled PHP functions

**This is the step that most often breaks the deployment, and it fails
silently.**

aaPanel hardens PHP by disabling process functions. The Stellar CLI bridge and
the background reconciler both require them.

**App Store → PHP 8.3 → Setting → Disabled functions.** Remove each of:

| Function                        | Needed by                                      |
| ------------------------------- | ---------------------------------------------- |
| `exec`                          | `SpawnsChainReconcile.php:29` (POSIX branch)   |
| `shell_exec`, `popen`           | process helpers                                 |
| `proc_open`                     | Symfony Process → the `stellar` CLI            |
| `putenv`                        | `StellarService::processEnv()` temp-dir handling |
| `symlink`                       | `artisan storage:link` (Step 9)                |

Then **PHP 8.3 → Service → Restart**, and verify:

```bash
php -r 'var_dump(function_exists("exec"), function_exists("proc_open"), function_exists("putenv"));'
# all three must print bool(true)
```

If any print `false`, the panel edit did not apply — re-check the field and
confirm you restarted PHP-FPM, not just Nginx.

> **Security note.** Enabling `exec`/`proc_open` genuinely reduces PHP
> hardening. It is unavoidable for an app that shells out to a binary. Step 5
> (document root) is what keeps this from being dangerous. Do not skip it.

---

## Step 3 — Install the Stellar CLI

Install as root, then copy the binary somewhere the web user can execute.

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
source "$HOME/.cargo/env"
cargo install --locked stellar-cli
```

This compiles from source and takes 5–15 minutes on a small VPS. If it fails
with an out-of-memory error, add swap:

```bash
fallocate -l 2G /swapfile && chmod 600 /swapfile
mkswap /swapfile && swapon /swapfile
```

Now copy it out of `/root/`:

```bash
cp "$HOME/.cargo/bin/stellar" /usr/local/bin/stellar
chmod 755 /usr/local/bin/stellar
```

**This copy is not optional.** `cargo` installs to `/root/.cargo/bin/`, and
PHP-FPM runs as `www`, which cannot traverse `/root/`. Leaving it there produces
a "stellar CLI failed" error with no useful detail.

Verify **as the web user** — this single check tells you whether the deployment
will work at all:

```bash
sudo -u www /usr/local/bin/stellar --version
```

`config/services.php:51` reads `env('STELLAR_CLI', 'stellar')`, so you point at
this path via `.env` in Step 8 — no code change.

---

## Step 4 — Point the domain at the VPS

A real domain is required, not a bare IP:

- **Let's Encrypt will not issue a certificate for an IP address.** Without
  HTTPS, browsers block every call from your HTTPS Vercel frontend as mixed
  content.
- **Google OAuth rejects IP-based redirect URIs**, so login breaks.
- Invite links built from `APP_URL` (`GroupController.php:478`) would embed a
  raw IP.

In your DNS provider, add an `A` record:

```
Type: A    Name: api    Value: <VPS_IP>    TTL: automatic
```

Wait for propagation before continuing — Let's Encrypt validation fails if you
run it early:

```bash
dig +short api.yourdomain.com     # must return <VPS_IP>
```

Usually a few minutes; occasionally up to an hour.

---

## Step 5 — Create the site and set the document root

aaPanel → **Website → Add site**:

- **Domain:** `api.yourdomain.com`
- **PHP version:** 8.3
- Leave FTP and database off (you will create the DB in Step 7)

**If you already created the site**, you do not need to delete it. Edit the
domain under **Website → your site → Domain management**.

### Set the running directory

**Website → your site → Site directory:**

- **Root directory:** `/www/wwwroot/saji`
- **Running directory:** `/backend/public`
- Leave **Anti-XSS** enabled

### Apply the Laravel rewrite

**Website → your site → URL rewrite → select `laravel5`.**

That preset name is correct for all modern Laravel versions despite the "5".
If your aaPanel build lacks it, paste this instead:

```nginx
location / {
    try_files $uri $uri/ /index.php?$query_string;
}
```

> **Why this matters most.** Laravel serves from `backend/public/`. If the
> document root is the repo root, `https://api.yourdomain.com/.env` is publicly
> downloadable — and that file contains `STELLAR_SERVICE_SECRET`, which controls
> on-chain funds. You will verify this in Step 9.

---

## Step 6 — Clone and install dependencies

```bash
cd /www/wwwroot
rm -rf saji                      # only if aaPanel pre-created placeholder files
git clone <your-repo-url> saji
cd saji/backend
```

Install Composer if the VPS lacks it:

```bash
curl -sS https://getcomposer.org/installer | php
mv composer.phar /usr/local/bin/composer
```

Then:

```bash
composer install --no-dev --optimize-autoloader
```

`--no-dev` skips PHPUnit, Pint, and Pail, which are not needed in production and
pull in a lot of extra code.

If Composer complains about the PHP version, confirm the CLI PHP is 8.3 —
aaPanel's CLI default sometimes differs from the site's version:

```bash
/www/server/php/83/bin/php /usr/local/bin/composer install --no-dev --optimize-autoloader
```

---

## Step 7 — Create the database

aaPanel → **Databases → Add database**:

- **Database name:** `saji`
- **Username:** `saji`
- **Password:** generate a strong one and copy it

Note all three; they go into `.env` next. Keep access set to local only
(`127.0.0.1`) — the app connects from the same machine, so the DB never needs a
public port.

---

## Step 8 — Configure `.env`

```bash
cd /www/wwwroot/saji/backend
cp .env.example .env
nano .env
```

Set these. Everything not listed can keep its `.env.example` default.

```dotenv
APP_NAME=Saji
APP_ENV=production
APP_DEBUG=false
APP_KEY=                                   # see below
APP_URL=https://api.yourdomain.com

# CORS allowlist (config/cors.php:26), comma-separated.
# ORDER MATTERS — the FIRST entry is used as the redirect target for Google
# OAuth (GoogleController.php:93) and group invite links
# (GroupController.php:478). Put the canonical frontend origin first.
FRONTEND_URL=https://your-app.vercel.app

DB_CONNECTION=mysql
DB_HOST=127.0.0.1
DB_PORT=3306
DB_DATABASE=saji
DB_USERNAME=saji
DB_PASSWORD=<from Step 7>

SESSION_DRIVER=database
CACHE_STORE=database
QUEUE_CONNECTION=database
FILESYSTEM_DISK=local

LOG_CHANNEL=stack
LOG_LEVEL=error

# Absolute path from Step 3.
STELLAR_CLI=/usr/local/bin/stellar
```

### Application key

Copy `APP_KEY` from your local `.env` to keep existing encrypted data readable.
For a fresh database, generate one instead:

```bash
php artisan key:generate
```

### Stellar values

Copy every `STELLAR_*` line from your local `.env` unchanged. This deployment
runs on **testnet**, and those values are already internally consistent.

When you later move to mainnet, `STELLAR_NETWORK`, `STELLAR_RPC_URL`,
`STELLAR_CONTRACT_ID`, and every `*_SAC` / `*_ISSUER` value must change
**together** — a partial switch reads the wrong ledger silently instead of
erroring. Generate a **fresh** `STELLAR_SERVICE_SECRET` for mainnet; the testnet
key has lived in local dev environments and must never custody real funds.

### Google OAuth

```dotenv
GOOGLE_CLIENT_ID=<from local .env>
GOOGLE_CLIENT_SECRET=<from local .env>
GOOGLE_REDIRECT_URI="${APP_URL}/api/auth/google/callback"
```

Leave `GOOGLE_REDIRECT_URI` as the `${APP_URL}` interpolation — it follows
`APP_URL` automatically. You still must register the resulting URL in Google
Cloud; see Step 12.

### Email

```dotenv
MAIL_MAILER=resend
RESEND_API_KEY=<from local .env>
MAIL_FROM_ADDRESS="noreply@yourdomain.com"
MAIL_FROM_NAME="${APP_NAME}"
```

See Step 12 — the current `MAIL_FROM_ADDRESS` will not work from a new domain.

### Lock the file down

```bash
chown www:www .env
chmod 600 .env
```

---

## Step 9 — Permissions, migrations, caches

```bash
cd /www/wwwroot/saji/backend

chown -R www:www /www/wwwroot/saji
chmod -R 775 storage bootstrap/cache

php artisan migrate --force
php artisan storage:link

php artisan config:cache
php artisan route:cache
php artisan view:cache
```

`--force` is required because `APP_ENV=production` makes migrations prompt
otherwise. `storage:link` needs `symlink` enabled from Step 2.

> **Re-run the three `:cache` commands after every `.env` change.** Once config
> is cached, edits to `.env` have no effect until you do. This is the single
> most common source of "I changed it but nothing happened".

### Confirm the document root is correct

```bash
curl -I http://api.yourdomain.com/.env     # must be 403 or 404 — never 200
curl    http://api.yourdomain.com/up       # Laravel health check → 200
```

If `.env` returns 200, stop and fix Step 5 before going further. Then rotate
`STELLAR_SERVICE_SECRET`, `GOOGLE_CLIENT_SECRET`, and `RESEND_API_KEY`, since
they were briefly public.

---

## Step 10 — Run the scheduler

Without this, the chain indexer never runs: contributions stay pending, group
status never advances, and the activity feed stays empty.

Because you have root, use `schedule:work` rather than a one-minute cron — it
honors the `everyThirtySeconds()` cadence the code actually specifies.

First confirm your PHP binary path:

```bash
which php          # often /www/server/php/83/bin/php on aaPanel
```

Create `/etc/systemd/system/saji-scheduler.service`:

```ini
[Unit]
Description=Saji Laravel scheduler
After=network.target mysqld.service

[Service]
Type=simple
User=www
Group=www
WorkingDirectory=/www/wwwroot/saji/backend
ExecStart=/www/server/php/83/bin/php /www/wwwroot/saji/backend/artisan schedule:work
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Adjust `ExecStart` to the path `which php` reported. Then:

```bash
systemctl daemon-reload
systemctl enable --now saji-scheduler
systemctl status saji-scheduler        # expect "active (running)"
```

Confirm the indexer itself works:

```bash
cd /www/wwwroot/saji/backend
sudo -u www php artisan chain:index    # should finish without error
tail -f storage/logs/laravel.log
```

**Queue worker.** `QUEUE_CONNECTION=database`, but `app/Jobs/` is currently
empty, so no worker is needed yet. Add one the same way —
`ExecStart=… artisan queue:work --tries=3` — as soon as you dispatch a job.

---

## Step 11 — Enable SSL

Vercel serves the frontend over HTTPS, so an HTTP backend gets blocked as mixed
content and every API call fails.

aaPanel → **Website → your site → SSL → Let's Encrypt** → select the domain →
**Apply**. Then toggle **Force HTTPS**.

```bash
curl -I https://api.yourdomain.com/up      # expect 200
curl -I http://api.yourdomain.com/up       # expect 301 → https
```

If issuance fails, DNS has not propagated (recheck `dig`) or port 80 is blocked
— Let's Encrypt needs it for HTTP-01 validation, even for an HTTPS certificate.

---

## Step 12 — Google OAuth and email

Both are easy to forget and both break user-visible flows.

### Google OAuth redirect URI

Google Cloud Console → **APIs & Services → Credentials** → your OAuth 2.0 client
→ **Authorized redirect URIs** → add exactly:

```
https://api.yourdomain.com/api/auth/google/callback
```

It must match `GOOGLE_REDIRECT_URI` character for character, including `https`
and no trailing slash. A mismatch yields `redirect_uri_mismatch` at login.

Also confirm `FRONTEND_URL`'s **first** entry is your production frontend —
`GoogleController.php:93` uses only that first value when redirecting the user
back after login. A stale `http://localhost:3000` in front sends production
users to their own machine.

### Email sending domain

Your local config uses:

```dotenv
MAIL_MAILER=resend
MAIL_FROM_ADDRESS="info@updates.andreawoodsllp.com"
```

That `from` domain must be verified in the Resend account tied to your
`RESEND_API_KEY`. If it belongs to a different project, **OTP registration will
fail** — `/auth/register/start` mails a code, and Resend rejects unverified
sender domains.

In Resend: **Domains → Add domain**, add your own, publish the DKIM/SPF records
it gives you, then set `MAIL_FROM_ADDRESS` to an address on that domain.

To confirm mail works end to end:

```bash
cd /www/wwwroot/saji/backend
sudo -u www php artisan tinker
>>> Mail::raw('test', fn($m) => $m->to('you@example.com')->subject('Saji test'));
```

---

## Step 13 — Connect the frontend

Vercel project → **Settings → Environment Variables**:

```
NEXT_PUBLIC_API_URL = https://api.yourdomain.com
```

No trailing slash — `src/lib/api/index.ts:113` concatenates paths directly.

**Then redeploy.** `NEXT_PUBLIC_*` values are inlined at build time, so an
existing deployment keeps using the old value until rebuilt. Deployments →
latest → **Redeploy**.

Finally, make sure `FRONTEND_URL` in the backend `.env` matches your real Vercel
origin, and re-run `php artisan config:cache`.

---

## Step 14 — Testnet exposure

This deployment runs against **Stellar testnet**, which is the right way to run
staging. Nothing in the setup changes. What changes is that the API is now
publicly reachable.

The exposure is narrow — `routes/api.php:45` puts every wallet, group, and
challenge route behind `auth:sanctum`, and auth endpoints are throttled to 6
requests/minute (`routes/api.php:31`) — but two things are worth knowing:

- **Anyone who finds the domain can register an account** and create groups.
  Throttling slows automated signups; it does not prevent them. Expect junk rows
  if the URL circulates.
- **`STELLAR_SERVICE_SECRET`'s account pays transaction fees.** Testnet XLM is
  free, but the account still drains under sustained use, after which on-chain
  writes fail with fee errors that look like unrelated bugs. Check its balance
  first when something "randomly stops working"; refill at
  <https://friendbot.stellar.org>.

If this is staging rather than a public beta, gate it:

**Website → your site → Password access** (HTTP basic auth), or restrict by IP
under **Website → your site → Deny/Allow**.

Note that basic auth also blocks your frontend's API calls. Either gate the
Vercel deployment too (Vercel offers deployment password protection) or use IP
restriction, which still permits browser traffic from allowed networks.

---

## Verification checklist

```bash
# 1. Health endpoint
curl https://api.yourdomain.com/up

# 2. Secrets not exposed  (must NOT be 200)
curl -I https://api.yourdomain.com/.env

# 3. Stellar CLI reachable by the web user
sudo -u www /usr/local/bin/stellar --version

# 4. Process functions enabled
php -r 'var_dump(function_exists("exec"), function_exists("proc_open"), function_exists("putenv"));'

# 5. Scheduler running
systemctl status saji-scheduler

# 6. Indexer works
cd /www/wwwroot/saji/backend && sudo -u www php artisan chain:index

# 7. CORS reflects your frontend origin
curl -H "Origin: https://your-app.vercel.app" -I https://api.yourdomain.com/api/groups
```

Then in a browser, end to end:

1. Load the frontend
2. Register with email (proves Resend works)
3. Sign in with Google (proves the redirect URI matches)
4. Connect a wallet
5. Create a group and make a contribution
6. Confirm it moves from pending to confirmed within ~30s (proves the scheduler)

Watch the log while you do it:

```bash
tail -f /www/wwwroot/saji/backend/storage/logs/laravel.log
```

---

## Troubleshooting

**`stellar CLI failed:` in the logs**
The binary is not reachable by `www`. Re-run check 3. Confirm `STELLAR_CLI` is
an absolute path and that you ran `php artisan config:cache` after setting it.

**On-chain actions succeed but the UI stays stale**
The scheduler is not running, or `chain:index` is erroring. Run it by hand
(check 6) and read the output. Also check the service account's testnet balance.

**CORS errors in the browser console**
`FRONTEND_URL` does not contain the exact Vercel origin (scheme + host, no
trailing slash), or the config cache is stale. Note `supports_credentials` is
`false` in `config/cors.php` — auth is bearer-token, not cookie-based, so that
is correct; do not change it.

**Google login redirects to localhost**
`FRONTEND_URL`'s first entry is still a localhost URL. `GoogleController.php:93`
uses only the first value. Reorder so production leads.

**`redirect_uri_mismatch` from Google**
The URI in Google Cloud does not exactly match `${APP_URL}/api/auth/google/callback`.
Compare scheme, host, path, and trailing slash character by character.

**OTP emails never arrive**
`MAIL_FROM_ADDRESS`'s domain is not verified in Resend — see Step 12. Check
`storage/logs/laravel.log` for the Resend API error.

**500 with a blank page**
`storage/` is not writable by `www`, or the config cache is stale. Re-run the
`chown`/`chmod` from Step 9. Read `storage/logs/laravel.log` — do **not** set
`APP_DEBUG=true` on a public host to diagnose it.

**Uploads 404 after saving**
`php artisan storage:link` did not run, or `symlink` is still disabled (Step 2).

**404 on every route except `/`**
The rewrite rule is missing. Re-apply the `laravel5` preset in Step 5.

**Changes to `.env` have no effect**
Config is cached. Run `php artisan config:cache` again.

---

## Redeploying

```bash
cd /www/wwwroot/saji
git pull
cd backend
composer install --no-dev --optimize-autoloader
php artisan migrate --force
php artisan config:cache && php artisan route:cache && php artisan view:cache
systemctl restart saji-scheduler
```

Restarting the scheduler matters: `schedule:work` is long-lived and holds the
old code in memory until it restarts.

For frontend changes, push to the branch Vercel tracks — it rebuilds
automatically. Only re-set `NEXT_PUBLIC_API_URL` if the backend domain changes.
