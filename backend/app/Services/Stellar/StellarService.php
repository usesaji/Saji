<?php

namespace App\Services\Stellar;

/**
 * Thin seam over Stellar / Soroban. Every place the backend touches the chain
 * goes through here.
 *
 * Saji is NON-CUSTODIAL: the backend never holds a user's private key. Money
 * actions are signed by the user's connected wallet. This service's job is to
 * BUILD unsigned transactions (XDR) for the frontend to sign, and to SUBMIT the
 * signed result / read on-chain state — never to sign on a user's behalf.
 */
class StellarService
{
    /**
     * Build a Stellar explorer link for a tx hash (Testnet).
     */
    public function explorerUrl(string $txHash): string
    {
        return "https://stellar.expert/explorer/testnet/tx/{$txHash}";
    }

    // --- Contract invocations (implemented in later milestones) ---
    // Each returns an unsigned transaction envelope (XDR) for the wallet to
    // sign, EXCEPT triggerPayout which the scheduler may submit itself since it
    // needs no user authority.
    //
    // public function buildCreateGroupTx(...): string {}   // organizer signs
    // public function buildJoinGroupTx(...): string {}     // organizer signs
    // public function buildContributeTx(...): string {}    // member wallet signs
    // public function submitSigned(string $signedXdr) {}   // broadcast to RPC
    // public function triggerPayout(...) {}                // no user auth needed
}
