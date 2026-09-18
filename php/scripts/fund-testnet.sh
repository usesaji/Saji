#!/usr/bin/env bash
#
# Send test USDC / USDT / XLM to a Stellar TESTNET account.
#
#   ./fund-testnet.sh G...ADDRESS                 # 1000 USDC + 1000 USDT
#   ./fund-testnet.sh G...ADDRESS USDC            # just USDC
#   ./fund-testnet.sh G...ADDRESS USDC 5000       # a specific amount
#
# USDC and USDT here are SELF-ISSUED testnet assets: we control their issuer
# keys, so we can mint on demand. No public testnet faucet exists for USDT, and
# the SDF/Circle USDC only arrives through the SEP-24 anchor flow.
#
# IMPORTANT: the destination must already hold a trustline for the asset. Only
# the account's own key can authorize that, so it cannot be done from here —
# add it in Freighter first (Manage Assets → Add Asset → Add Manually) using the
# issuer addresses printed by --info.
#
# TESTNET ONLY.
set -euo pipefail

HORIZON="https://horizon-testnet.stellar.org"

# Run from backend/ and the CLI picks up STELLAR_RPC_URL out of the Laravel
# .env, then errors because no passphrase accompanies it. Pass both explicitly
# so this works from any directory.
RPC_URL="https://soroban-testnet.stellar.org"
PASSPHRASE="Test SDF Network ; September 2015"
NET=(--rpc-url "$RPC_URL" --network-passphrase "$PASSPHRASE")

USDC_ISSUER="GCBJNSZUUPK5HSB3JLQB37OLEE4VW2WE3ZUDGAMPBTGP5LJ6AT4U7H5M"
USDT_ISSUER="GCEKXEAHM3NHGG7A6VTZ5OBZDBOC3VIZF26UDX43FGMDABMJHHRLZFKD"
USDC_SAC="CCOY5JSTYMV4WN6W7WZS7JRMZXHSHKGEZQ5PCHEEAZLFQIVVFFHWCX7V"
USDT_SAC="CCM5YODOEZSDQNYO466BEH232DC2YYHCWULB6HA7PLEOKAOJIJP5GO2N"

# Identities holding the issuer keys (created by `stellar keys generate`).
USDC_SIGNER="saji-usdc-issuer"
USDT_SIGNER="saji-usdt-issuer"

print_info() {
  cat <<INFO
Test assets — add these in Freighter before funding:

  USDC
    code:   USDC
    issuer: $USDC_ISSUER

  USDT
    code:   USDT
    issuer: $USDT_ISSUER

Freighter: Manage Assets → Add Asset → Add Manually → paste code + issuer.
XLM needs no trustline (it's native; use friendbot to create the account).
INFO
}

if [[ "${1:-}" == "--info" || -z "${1:-}" ]]; then
  print_info
  [[ -z "${1:-}" ]] && { echo; echo "usage: $0 <G...address> [USDC|USDT|XLM] [amount]"; }
  exit 0
fi

ADDRESS="$1"; shift
ASSET="${1:-ALL}"
AMOUNT="${2:-1000}"

account_json() { curl -s "$HORIZON/accounts/$ADDRESS"; }

# --- account must exist -------------------------------------------------------
if [[ "$(curl -s -o /dev/null -w '%{http_code}' "$HORIZON/accounts/$ADDRESS")" != "200" ]]; then
  echo "→ account doesn't exist yet — funding with friendbot…"
  curl -s "https://friendbot.stellar.org/?addr=$ADDRESS" > /dev/null
  sleep 3
fi

has_trustline() {
  account_json | node -e "
    let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{
      const j=JSON.parse(s);
      const hit=(j.balances||[]).some(b=>b.asset_code===process.argv[1]&&b.asset_issuer===process.argv[2]);
      process.exit(hit?0:1);
    })" "$1" "$2"
}

send_asset() {
  local code="$1" issuer="$2" sac="$3" signer="$4"

  if ! has_trustline "$code" "$issuer"; then
    echo "✗ $code: no trustline on $ADDRESS"
    echo "    Add it in Freighter first:"
    echo "      code:   $code"
    echo "      issuer: $issuer"
    return 1
  fi

  # SAC amounts are in stroops (7 decimals).
  local stroops
  stroops=$(node -e "process.stdout.write(String(BigInt(Math.round(Number(process.argv[1])*1e7))))" "$AMOUNT")

  echo "→ minting $AMOUNT $code …"
  local out rc
  set +e
  out=$(stellar contract invoke --id "$sac" --source-account "$signer" \
        "${NET[@]}" --send=yes -- mint --to "$ADDRESS" --amount "$stroops" 2>&1)
  rc=$?
  set -e
  if [[ $rc -eq 0 ]]; then
    echo "  ✓ sent"
  else
    echo "  ✗ mint failed:"
    echo "$out" | tail -4 | sed 's/^/      /'
    return 1
  fi
}

case "$ASSET" in
  USDC) send_asset USDC "$USDC_ISSUER" "$USDC_SAC" "$USDC_SIGNER" || true ;;
  USDT) send_asset USDT "$USDT_ISSUER" "$USDT_SAC" "$USDT_SIGNER" || true ;;
  XLM)  echo "→ XLM: friendbot already funded the account" ;;
  ALL)
    send_asset USDC "$USDC_ISSUER" "$USDC_SAC" "$USDC_SIGNER" || true
    send_asset USDT "$USDT_ISSUER" "$USDT_SAC" "$USDT_SIGNER" || true
    ;;
  *) echo "unknown asset '$ASSET' (expected USDC, USDT, XLM)" >&2; exit 1 ;;
esac

echo
echo "Balances for $ADDRESS:"
account_json | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{
  const j=JSON.parse(s);
  for(const b of j.balances) {
    const code = b.asset_type==='native' ? 'XLM' : b.asset_code;
    console.log('  '+code.padEnd(6)+b.balance);
  }
})"
