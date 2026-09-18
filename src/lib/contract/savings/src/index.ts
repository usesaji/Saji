import { Buffer } from "buffer";
import { Address } from "@stellar/stellar-sdk";
import {
  AssembledTransaction,
  Client as ContractClient,
  ClientOptions as ContractClientOptions,
  MethodOptions,
  Result,
  Spec as ContractSpec,
} from "@stellar/stellar-sdk/contract";
import type {
  u32,
  i32,
  u64,
  i64,
  u128,
  i128,
  u256,
  i256,
  Option,
  Timepoint,
  Duration,
} from "@stellar/stellar-sdk/contract";
export * from "@stellar/stellar-sdk";
export * as contract from "@stellar/stellar-sdk/contract";
export * as rpc from "@stellar/stellar-sdk/rpc";

if (typeof window !== "undefined") {
  //@ts-ignore Buffer exists
  window.Buffer = window.Buffer || Buffer;
}




export const Errors = {
  1: {message:"GroupNotFound"},
  /**
   * Reserved: organizer-gated actions revert via `require_auth()` today, but
   * this typed variant is kept stable in the ABI for the future
   * `resolve_default` hook (SPEC §7), which will check it explicitly.
   */
  2: {message:"NotOrganizer"},
  3: {message:"InvalidFee"},
  4: {message:"InvalidAmount"},
  5: {message:"WrongStatus"},
  6: {message:"AlreadyMember"},
  7: {message:"NotMember"},
  8: {message:"AlreadyContributed"},
  9: {message:"NotAllContributed"},
  10: {message:"TooFewMembers"},
  11: {message:"InvalidCycleLength"},
  /**
   * A proposed manual order isn't a valid permutation of the current members
   * (wrong length, missing member, or a duplicate/stranger).
   */
  12: {message:"InvalidOrder"},
  /**
   * set_payout_order was called on a group whose order is Random/Vote/etc.,
   * where an explicit manual order does not apply.
   */
  13: {message:"OrderNotManual"},
  /**
   * resolve_default was called on a member who is not (or no longer) eligible
   * to be defaulted: not a member, already defaulted, or already paid this
   * cycle, or the grace period has not yet elapsed.
   */
  14: {message:"NotDefaultable"},
  /**
   * The group has too many members for a single-transaction payout to stay
   * within resource limits (see MAX_MEMBERS).
   */
  15: {message:"TooManyMembers"},
  /**
   * claim_payout was called by a member who has nothing owed to claim.
   */
  16: {message:"NothingToClaim"},
  /**
   * A transfer would exceed what the contract actually holds. Every group's
   * funds share one token balance, so this catches per-group bookkeeping
   * drifting above reality before it can spend another circle's escrow.
   */
  17: {message:"InsufficientEscrow"},
  /**
   * A contribution was attempted before this cycle's deposit window opened.
   * The previous cycle paid out early, but the SCHEDULE still holds: the next
   * round cannot start before `cycle_length` has elapsed.
   */
  19: {message:"CycleNotOpen"},
  /**
   * The current cycle's recipient tried to contribute. They are exempt — the
   * pot they are about to receive is funded by everyone else.
   */
  20: {message:"RecipientExempt"},
  /**
   * claim_payout was given the contract's own address as the destination.
   * That would clear the claim while the tokens never move, destroying the
   * payout with no way to recover it.
   */
  18: {message:"InvalidDestination"}
}

export enum Status {
  Draft = 0,
  Open = 1,
  Active = 2,
  Completed = 3,
}

/**
 * Storage keys — every group-scoped key carries the `group_id` so funds and
 * state for one group can never be addressed by another (invariant #1).
 */
export type DataKey = {tag: "GroupCount", values: void} | {tag: "Config", values: readonly [u64]} | {tag: "Members", values: readonly [u64]} | {tag: "Pool", values: readonly [u64]} | {tag: "Cycle", values: readonly [u64]} | {tag: "Contributed", values: readonly [u64, u32, string]} | {tag: "Received", values: readonly [u64, string]} | {tag: "Defaulted", values: readonly [u64, string]} | {tag: "PaidTotal", values: readonly [u64, string]} | {tag: "Unrotated", values: readonly [u64, string]} | {tag: "LateFees", values: readonly [u64, string]} | {tag: "LateFeeCharged", values: readonly [u64, u32, string]} | {tag: "CycleStart", values: readonly [u64]} | {tag: "Claimable", values: readonly [u64, string]};


export interface GroupConfig {
  amount: i128;
  cycle_length: u64;
  fee_bps: u32;
  /**
 * Seconds after a contribution's due time a member may still pay before
 * counting as a default. Stored for the same future hook.
 */
grace_period: u64;
  /**
 * Penalty a late payer owes, in bps of `amount`. Stored for the documented
 * default-handling hook (SPEC §7); not yet charged in the strict MVP.
 */
late_fee_bps: u32;
  /**
 * What happens on a missed contribution (see `LatePenalty`). Recorded now;
 * enforced by the future default-handling upgrade.
 */
late_penalty: LatePenalty;
  member_count: u32;
  organizer: string;
  /**
 * Rotation-order policy chosen at creation (see `PayoutOrder`).
 */
payout_order: PayoutOrder;
  status: Status;
  token: string;
}

/**
 * What happens to a member who misses a contribution past the grace period.
 * Both are now enforced by `resolve_default` (organizer-gated):
 * - `DeductFromBalance`: accrue a late fee (bps of `amount`) that is later
 * subtracted from the member's own payout and paid to the organizer.
 * - `RemoveMember`: mark the member defaulted — they are skipped for all
 * future contributions AND their own payout turn, and whatever they had
 * already paid into the pool is refunded to their wallet.
 * `resolve_default` also auto-removes ANY defaulter whose wallet can no longer
 * cover the contribution, regardless of this setting ("empty wallet ⇒ out").
 */
export enum LatePenalty {
  DeductFromBalance = 0,
  RemoveMember = 1,
}

/**
 * How the payout rotation order is decided. The contract always pays the
 * member at `Cycle`'s index in the `Members` vec; this field records the
 * policy the organizer chose off-chain so it is auditable on-chain and so a
 * future upgrade can enforce ordering (e.g. a verifiable random shuffle).
 * How the payout rotation order is decided. The contract pays the member at
 * `Cycle`'s index in the `Members` vec; with `Manual` the organizer can set
 * that order explicitly via `set_payout_order` before the cycle starts.
 */
export enum PayoutOrder {
  Manual = 0,
  Random = 1,
  Vote = 2,
  Custom = 3,
}

export interface Client {
  /**
   * Construct and simulate a get_pool transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_pool: ({group_id}: {group_id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<i128>>

  /**
   * Construct and simulate a get_cycle transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_cycle: ({group_id}: {group_id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<u32>>

  /**
   * Construct and simulate a get_group transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_group: ({group_id}: {group_id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<Result<GroupConfig>>>

  /**
   * Construct and simulate a amount_due transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * What `member` must actually send to contribute: the fixed amount plus any
   * late fee they have accrued. The UI needs this so the confirmation screen
   * matches what the wallet will be asked to transfer.
   */
  amount_due: ({group_id, member}: {group_id: u64, member: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<i128>>>

  /**
   * Construct and simulate a contribute transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * A member contributes the fixed amount for the current cycle. The member
   * authorizes with their connected wallet; the token is pulled into the
   * contract's own balance (escrow). Binds identity to authority: the
   * signer must already be a member of THIS group (invariant #8).
   */
  contribute: ({group_id, member}: {group_id: u64, member: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a is_removed transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Whether a member has been removed from the rotation (defaulted).
   */
  is_removed: ({group_id, member}: {group_id: u64, member: string}, options?: MethodOptions) => Promise<AssembledTransaction<boolean>>

  /**
   * Construct and simulate a join_group transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Organizer admits a new member. Only allowed while the group is still
   * forming (Draft/Open) so the rotation order is fixed before any money.
   */
  join_group: ({group_id, member}: {group_id: u64, member: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a get_members transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_members: ({group_id}: {group_id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<Array<string>>>

  /**
   * Construct and simulate a late_fee_of transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Accrued late-fee debt (token stroops) that will be netted out of the
   * member's eventual payout.
   */
  late_fee_of: ({group_id, member}: {group_id: u64, member: string}, options?: MethodOptions) => Promise<AssembledTransaction<i128>>

  /**
   * Construct and simulate a start_cycle transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Organizer starts the first cycle, locking the rotation order. Requires
   * at least two members (a one-person circle is meaningless).
   */
  start_cycle: ({group_id}: {group_id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a claimable_of transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Amount (token stroops) this member is owed and can `claim_payout`. 0 means
   * nothing to claim. The Withdraw screen reads this to show a claim button.
   */
  claimable_of: ({group_id, member}: {group_id: u64, member: string}, options?: MethodOptions) => Promise<AssembledTransaction<i128>>

  /**
   * Construct and simulate a claim_payout transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Claim a payout that a completed cycle earmarked for `member`, sending it
   * to `to` — the "Withdraw" action for a circle payout.
   * 
   * Non-custodial: the funds were held by the contract, never by Saji, and
   * only move on the member's own signature. `member.require_auth()` means
   * naming a destination is the member's choice alone — nobody else can
   * redirect their payout. `to` is deliberately unrestricted so a member can
   * withdraw straight to any wallet they choose; it may equal `member`.
   * 
   * The claimable entry stays keyed on `member` (not `to`), so a claim to a
   * third party still clears the right balance and can't be replayed.
   * 
   * The one destination that is rejected is the contract itself: that would
   * clear the claim while the tokens never moved, destroying the payout.
   * 
   * Note: if `to` holds no trustline for the group's token the transfer
   * panics and the whole claim reverts — the payout stays escrowed and
   * claimable, so nothing is lost. Callers should check first.
   * 
   * Returns the claimed amount (stroops).
   */
  claim_payout: ({group_id, member, to}: {group_id: u64, member: string, to: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<i128>>>

  /**
   * Construct and simulate a create_group transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Create a savings group. The organizer becomes member #1. Returns the
   * new `group_id`. The organizer authorizes this call with their wallet.
   */
  create_group: ({organizer, token, amount, cycle_length, fee_bps, late_fee_bps, grace_period, payout_order, late_penalty}: {organizer: string, token: string, amount: i128, cycle_length: u64, fee_bps: u32, late_fee_bps: u32, grace_period: u64, payout_order: PayoutOrder, late_penalty: LatePenalty}, options?: MethodOptions) => Promise<AssembledTransaction<Result<u64>>>

  /**
   * Construct and simulate a next_recipient transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * The address that will receive the current cycle's payout: the first
   * member in rotation order who is active (not defaulted) and has not yet
   * received. Mirrors the selection in `trigger_payout`.
   */
  next_recipient: ({group_id}: {group_id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<Result<string>>>

  /**
   * Construct and simulate a trigger_payout transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Pay the current cycle's recipient. Callable by anyone (e.g. the backend
   * scheduler) since it can only ever pay the rules-determined recipient.
   * 
   * Strict-but-fair completeness: every member who is still ACTIVE (not
   * defaulted) must have paid this cycle. Defaulted members are skipped — the
   * organizer removes them via `resolve_default` first, which also refunds
   * what they had paid, so their absence never blocks the circle.
   * 
   * The recipient is the next member in rotation order who has NOT already
   * received AND is NOT defaulted. Any late-fee debt they accrued is netted
   * out of their payout and sent to the organizer.
   * 
   * PULL-BASED: the recipient's net is NOT pushed to their wallet here.
   * Instead it is recorded as a claimable balance (funds stay escrowed in the
   * contract — non-custodial) and the recipient signs `claim_payout` to
   * withdraw it. Only the service/late fee is transferred out immediately, to
   * the organizer. This makes the Withdraw/Claim action the way a member
   * receives their turn's money, while keeping custody in the
   */
  trigger_payout: ({group_id}: {group_id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a has_contributed transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  has_contributed: ({group_id, cycle, member}: {group_id: u64, cycle: u32, member: string}, options?: MethodOptions) => Promise<AssembledTransaction<boolean>>

  /**
   * Construct and simulate a resolve_default transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Organizer resolves a member who has missed the current cycle past the
   * grace period. Enforces the two-part rule from the product design:
   * 
   * * If the member's wallet can no longer cover the contribution (empty
   * wallet), they are REMOVED regardless of the group's penalty policy —
   * marked defaulted, skipped in all future cycles and their own payout
   * turn, and everything they had already paid in is REFUNDED to them.
   * * Otherwise, apply the group's `late_penalty`:
   * - `RemoveMember`   → remove + refund (as above).
   * - `DeductFromBalance` → accrue a late fee (bps of `amount`) that is
   * later netted out of the member's own payout to the organizer.
   * 
   * Organizer-gated. Only valid while Active, only when the grace period
   * (`cycle_length + grace_period` seconds since the cycle's start) has
   * elapsed and the member has NOT paid this cycle.
   */
  resolve_default: ({group_id, member}: {group_id: u64, member: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a deposits_open_at transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Ledger timestamp at which THIS cycle's deposits opened (or will open).
   * 
   * A cycle can settle well before its length elapses, so the next round's
   * deposit window is what carries the schedule. The UI needs this to show
   * "next contribution opens in ..." rather than letting a member sign a
   * transaction that reverts with `CycleNotOpen`.
   */
  deposits_open_at: ({group_id}: {group_id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<u64>>

  /**
   * Construct and simulate a set_payout_order transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Organizer sets the exact payout rotation order (the drag-and-drop "who
   * gets paid first" feature). Only valid while the group is still forming
   * (Draft/Open) and only when the group's policy is `Manual`. The proposed
   * `order` must be a permutation of the current members — same length, every
   * current member present exactly once — so no one is dropped or injected.
   * The order is frozen when `start_cycle` locks the group.
   */
  set_payout_order: ({group_id, order}: {group_id: u64, order: Array<string>}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a start_with_members transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * One-shot launch: admit the full member roster in the chosen payout order
   * AND start the first cycle, in a SINGLE organizer-signed transaction. This
   * is the "Start Circle" action — instead of admitting each joiner on-chain
   * (one signature each) then starting, the organizer accepts members in the
   * app (off-chain) and launches everyone at once here.
   * 
   * `order` is the complete rotation: every member (including the organizer)
   * exactly once, in payout order (index = payout position). It replaces the
   * member list wholesale, so it must:
   * - contain the organizer,
   * - have ≥ 2 entries and ≤ MAX_MEMBERS,
   * - have no duplicates.
   * Valid only while the group is still forming (Draft/Open). After this the
   * group is Active and the roster/order are locked.
   */
  start_with_members: ({group_id, order}: {group_id: u64, order: Array<string>}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

}
export class Client extends ContractClient {
  static async deploy<T = Client>(
    /** Options for initializing a Client as well as for calling a method, with extras specific to deploying. */
    options: MethodOptions &
      Omit<ContractClientOptions, "contractId"> & {
        /** The hash of the Wasm blob, which must already be installed on-chain. */
        wasmHash: Buffer | string;
        /** Salt used to generate the contract's ID. Passed through to {@link Operation.createCustomContract}. Default: random. */
        salt?: Buffer | Uint8Array;
        /** The format used to decode `wasmHash`, if it's provided as a string. */
        format?: "hex" | "base64";
      }
  ): Promise<AssembledTransaction<T>> {
    return ContractClient.deploy(null, options)
  }
  constructor(public readonly options: ContractClientOptions) {
    super(
      new ContractSpec([ "AAAABAAAAAAAAAAAAAAABUVycm9yAAAAAAAAFAAAAAAAAAANR3JvdXBOb3RGb3VuZAAAAAAAAAEAAADHUmVzZXJ2ZWQ6IG9yZ2FuaXplci1nYXRlZCBhY3Rpb25zIHJldmVydCB2aWEgYHJlcXVpcmVfYXV0aCgpYCB0b2RheSwgYnV0CnRoaXMgdHlwZWQgdmFyaWFudCBpcyBrZXB0IHN0YWJsZSBpbiB0aGUgQUJJIGZvciB0aGUgZnV0dXJlCmByZXNvbHZlX2RlZmF1bHRgIGhvb2sgKFNQRUMgwqc3KSwgd2hpY2ggd2lsbCBjaGVjayBpdCBleHBsaWNpdGx5LgAAAAAMTm90T3JnYW5pemVyAAAAAgAAAAAAAAAKSW52YWxpZEZlZQAAAAAAAwAAAAAAAAANSW52YWxpZEFtb3VudAAAAAAAAAQAAAAAAAAAC1dyb25nU3RhdHVzAAAAAAUAAAAAAAAADUFscmVhZHlNZW1iZXIAAAAAAAAGAAAAAAAAAAlOb3RNZW1iZXIAAAAAAAAHAAAAAAAAABJBbHJlYWR5Q29udHJpYnV0ZWQAAAAAAAgAAAAAAAAAEU5vdEFsbENvbnRyaWJ1dGVkAAAAAAAACQAAAAAAAAANVG9vRmV3TWVtYmVycwAAAAAAAAoAAAAAAAAAEkludmFsaWRDeWNsZUxlbmd0aAAAAAAACwAAAIFBIHByb3Bvc2VkIG1hbnVhbCBvcmRlciBpc24ndCBhIHZhbGlkIHBlcm11dGF0aW9uIG9mIHRoZSBjdXJyZW50IG1lbWJlcnMKKHdyb25nIGxlbmd0aCwgbWlzc2luZyBtZW1iZXIsIG9yIGEgZHVwbGljYXRlL3N0cmFuZ2VyKS4AAAAAAAAMSW52YWxpZE9yZGVyAAAADAAAAHZzZXRfcGF5b3V0X29yZGVyIHdhcyBjYWxsZWQgb24gYSBncm91cCB3aG9zZSBvcmRlciBpcyBSYW5kb20vVm90ZS9ldGMuLAp3aGVyZSBhbiBleHBsaWNpdCBtYW51YWwgb3JkZXIgZG9lcyBub3QgYXBwbHkuAAAAAAAOT3JkZXJOb3RNYW51YWwAAAAAAA0AAADAcmVzb2x2ZV9kZWZhdWx0IHdhcyBjYWxsZWQgb24gYSBtZW1iZXIgd2hvIGlzIG5vdCAob3Igbm8gbG9uZ2VyKSBlbGlnaWJsZQp0byBiZSBkZWZhdWx0ZWQ6IG5vdCBhIG1lbWJlciwgYWxyZWFkeSBkZWZhdWx0ZWQsIG9yIGFscmVhZHkgcGFpZCB0aGlzCmN5Y2xlLCBvciB0aGUgZ3JhY2UgcGVyaW9kIGhhcyBub3QgeWV0IGVsYXBzZWQuAAAADk5vdERlZmF1bHRhYmxlAAAAAAAOAAAAcFRoZSBncm91cCBoYXMgdG9vIG1hbnkgbWVtYmVycyBmb3IgYSBzaW5nbGUtdHJhbnNhY3Rpb24gcGF5b3V0IHRvIHN0YXkKd2l0aGluIHJlc291cmNlIGxpbWl0cyAoc2VlIE1BWF9NRU1CRVJTKS4AAAAOVG9vTWFueU1lbWJlcnMAAAAAAA8AAABCY2xhaW1fcGF5b3V0IHdhcyBjYWxsZWQgYnkgYSBtZW1iZXIgd2hvIGhhcyBub3RoaW5nIG93ZWQgdG8gY2xhaW0uAAAAAAAOTm90aGluZ1RvQ2xhaW0AAAAAABAAAADQQSB0cmFuc2ZlciB3b3VsZCBleGNlZWQgd2hhdCB0aGUgY29udHJhY3QgYWN0dWFsbHkgaG9sZHMuIEV2ZXJ5IGdyb3VwJ3MKZnVuZHMgc2hhcmUgb25lIHRva2VuIGJhbGFuY2UsIHNvIHRoaXMgY2F0Y2hlcyBwZXItZ3JvdXAgYm9va2tlZXBpbmcKZHJpZnRpbmcgYWJvdmUgcmVhbGl0eSBiZWZvcmUgaXQgY2FuIHNwZW5kIGFub3RoZXIgY2lyY2xlJ3MgZXNjcm93LgAAABJJbnN1ZmZpY2llbnRFc2Nyb3cAAAAAABEAAADHQSBjb250cmlidXRpb24gd2FzIGF0dGVtcHRlZCBiZWZvcmUgdGhpcyBjeWNsZSdzIGRlcG9zaXQgd2luZG93IG9wZW5lZC4KVGhlIHByZXZpb3VzIGN5Y2xlIHBhaWQgb3V0IGVhcmx5LCBidXQgdGhlIFNDSEVEVUxFIHN0aWxsIGhvbGRzOiB0aGUgbmV4dApyb3VuZCBjYW5ub3Qgc3RhcnQgYmVmb3JlIGBjeWNsZV9sZW5ndGhgIGhhcyBlbGFwc2VkLgAAAAAMQ3ljbGVOb3RPcGVuAAAAEwAAAIRUaGUgY3VycmVudCBjeWNsZSdzIHJlY2lwaWVudCB0cmllZCB0byBjb250cmlidXRlLiBUaGV5IGFyZSBleGVtcHQg4oCUIHRoZQpwb3QgdGhleSBhcmUgYWJvdXQgdG8gcmVjZWl2ZSBpcyBmdW5kZWQgYnkgZXZlcnlvbmUgZWxzZS4AAAAPUmVjaXBpZW50RXhlbXB0AAAAABQAAACuY2xhaW1fcGF5b3V0IHdhcyBnaXZlbiB0aGUgY29udHJhY3QncyBvd24gYWRkcmVzcyBhcyB0aGUgZGVzdGluYXRpb24uClRoYXQgd291bGQgY2xlYXIgdGhlIGNsYWltIHdoaWxlIHRoZSB0b2tlbnMgbmV2ZXIgbW92ZSwgZGVzdHJveWluZyB0aGUKcGF5b3V0IHdpdGggbm8gd2F5IHRvIHJlY292ZXIgaXQuAAAAAAASSW52YWxpZERlc3RpbmF0aW9uAAAAAAAS",
        "AAAAAAAAAAAAAAAIZ2V0X3Bvb2wAAAABAAAAAAAAAAhncm91cF9pZAAAAAYAAAABAAAACw==",
        "AAAAAwAAAAAAAAAAAAAABlN0YXR1cwAAAAAABAAAAAAAAAAFRHJhZnQAAAAAAAAAAAAAAAAAAARPcGVuAAAAAQAAAAAAAAAGQWN0aXZlAAAAAAACAAAAAAAAAAlDb21wbGV0ZWQAAAAAAAAD",
        "AAAAAAAAAAAAAAAJZ2V0X2N5Y2xlAAAAAAAAAQAAAAAAAAAIZ3JvdXBfaWQAAAAGAAAAAQAAAAQ=",
        "AAAAAAAAAAAAAAAJZ2V0X2dyb3VwAAAAAAAAAQAAAAAAAAAIZ3JvdXBfaWQAAAAGAAAAAQAAA+kAAAfQAAAAC0dyb3VwQ29uZmlnAAAAAAM=",
        "AAAAAgAAAJFTdG9yYWdlIGtleXMg4oCUIGV2ZXJ5IGdyb3VwLXNjb3BlZCBrZXkgY2FycmllcyB0aGUgYGdyb3VwX2lkYCBzbyBmdW5kcyBhbmQKc3RhdGUgZm9yIG9uZSBncm91cCBjYW4gbmV2ZXIgYmUgYWRkcmVzc2VkIGJ5IGFub3RoZXIgKGludmFyaWFudCAjMSkuAAAAAAAAAAAAAAdEYXRhS2V5AAAAAA4AAAAAAAAAAAAAAApHcm91cENvdW50AAAAAAABAAAAAAAAAAZDb25maWcAAAAAAAEAAAAGAAAAAQAAAAAAAAAHTWVtYmVycwAAAAABAAAABgAAAAEAAAAAAAAABFBvb2wAAAABAAAABgAAAAEAAAAAAAAABUN5Y2xlAAAAAAAAAQAAAAYAAAABAAAAPShncm91cF9pZCwgY3ljbGUsIG1lbWJlcikgLT4gaGFzIHRoaXMgbWVtYmVyIHBhaWQgdGhpcyBjeWNsZT8AAAAAAAALQ29udHJpYnV0ZWQAAAAAAwAAAAYAAAAEAAAAEwAAAAEAAABAKGdyb3VwX2lkLCBtZW1iZXIpIC0+IGhhcyB0aGlzIG1lbWJlciBhbHJlYWR5IHJlY2VpdmVkIGEgcGF5b3V0PwAAAAhSZWNlaXZlZAAAAAIAAAAGAAAAEwAAAAEAAACQKGdyb3VwX2lkLCBtZW1iZXIpIC0+IGhhcyB0aGlzIG1lbWJlciBkZWZhdWx0ZWQgYW5kIGJlZW4gcmVtb3ZlZCBmcm9tIHRoZQpyb3RhdGlvbj8gRGVmYXVsdGVkIG1lbWJlcnMgYXJlIHNraXBwZWQgZm9yIGNvbnRyaWJ1dGlvbnMgYW5kIHBheW91dHMuAAAACURlZmF1bHRlZAAAAAAAAAIAAAAGAAAAEwAAAAEAAAC3KGdyb3VwX2lkLCBtZW1iZXIpIC0+IHRvdGFsIHRva2VuIGFtb3VudCB0aGlzIG1lbWJlciBoYXMgcGFpZCBpbnRvIHRoZQpwb29sIGFjcm9zcyBhbGwgY3ljbGVzLiBMaWZldGltZSBmaWd1cmUsIGZvciBhdWRpdC9VSSBvbmx5IOKAlCBpdCBpcyBOT1QgYQpyZWZ1bmRhYmxlIGJhbGFuY2UgKHNlZSBgVW5yb3RhdGVkYCkuAAAAAAlQYWlkVG90YWwAAAAAAAACAAAABgAAABMAAAABAAAB5Chncm91cF9pZCwgbWVtYmVyKSAtPiB0aGUgcGFydCBvZiB0aGlzIG1lbWJlcidzIGNvbnRyaWJ1dGlvbnMgdGhhdCBoYXMKTk9UIHlldCBiZWVuIHJvdGF0ZWQgb3V0IHRvIGEgcmVjaXBpZW50LCBpLmUuIHRoZSBvbmx5IG1vbmV5IHN0aWxsCnNpdHRpbmcgaW4gdGhlIHBvb2wgb24gdGhlaXIgYmVoYWxmLgoKVGhpcyBpcyB3aGF0IGEgcmVtb3ZhbCBtYXkgcmVmdW5kLiBgUGFpZFRvdGFsYCBjYW5ub3QgYmU6IG9uY2UgYSBjeWNsZQpwYXlzIG91dCwgdGhhdCBwb29sIHdlbnQgdG8gc29tZW9uZSBlbHNlLCBzbyByZWZ1bmRpbmcgYWdhaW5zdCBhIGxpZmV0aW1lCnRvdGFsIGhhbmRzIHRoZSBkZWZhdWx0ZXIgbW9uZXkgYmVsb25naW5nIHRvIHRoZSBtZW1iZXJzIHdobyBmdW5kZWQgdGhlCkNVUlJFTlQgY3ljbGUuIENsZWFyZWQgZm9yIGV2ZXJ5b25lIG9uIGVhY2ggcGF5b3V0LCBzaW5jZSBhIHBheW91dApjb25zdW1lcyB0aGUgd2hvbGUgcG9vbC4AAAAJVW5yb3RhdGVkAAAAAAAAAgAAAAYAAAATAAAAAQAAAIcoZ3JvdXBfaWQsIG1lbWJlcikgLT4gYWNjcnVlZCBsYXRlLWZlZSBkZWJ0ICh0b2tlbiBzdHJvb3BzKSBkZWR1Y3RlZCBmcm9tCnRoaXMgbWVtYmVyJ3MgZXZlbnR1YWwgcGF5b3V0IGFuZCBmb3J3YXJkZWQgdG8gdGhlIG9yZ2FuaXplci4AAAAACExhdGVGZWVzAAAAAgAAAAYAAAATAAAAAQAAAMQoZ3JvdXBfaWQsIGN5Y2xlLCBtZW1iZXIpIC0+IGhhcyBhIGxhdGUgZmVlIGFscmVhZHkgYmVlbiBjaGFyZ2VkIHRvIHRoaXMKbWVtYmVyIGZvciB0aGlzIGN5Y2xlPyBDYXBzIGFjY3J1YWwgYXQgb25jZSBwZXIgY3ljbGUgc28gdGhlIGZlZSBjYW5ub3QgYmUKc3RhY2tlZCBieSBjYWxsaW5nIGByZXNvbHZlX2RlZmF1bHRgIHJlcGVhdGVkbHkuAAAADkxhdGVGZWVDaGFyZ2VkAAAAAAADAAAABgAAAAQAAAATAAAAAQAAAMcoZ3JvdXBfaWQpIC0+IGxlZGdlciB0aW1lc3RhbXAgd2hlbiB0aGUgY3VycmVudCBjeWNsZSBiZWNhbWUgZHVlIGZvcgpwYXlvdXQgdHJhY2tpbmcuIFNldCBvbiBzdGFydF9jeWNsZSBhbmQgZWFjaCBwYXlvdXQ7IHJlc29sdmVfZGVmYXVsdCB1c2VzCml0IHdpdGggZ3JhY2VfcGVyaW9kIHRvIGRlY2lkZSB3aGV0aGVyIGEgbWVtYmVyIGlzIGxhdGUuAAAAAApDeWNsZVN0YXJ0AAAAAAABAAAABgAAAAEAAAEDKGdyb3VwX2lkLCBtZW1iZXIpIC0+IHRva2VuIGFtb3VudCB0aGlzIG1lbWJlciBpcyBPV0VEIGFuZCBjYW4gY2xhaW0uClBheW91dHMgYXJlIHB1bGwtYmFzZWQ6IGB0cmlnZ2VyX3BheW91dGAgcmVjb3JkcyB0aGUgbmV0IGhlcmUgKGZ1bmRzIHN0YXkKZXNjcm93ZWQgaW4gdGhlIGNvbnRyYWN0LCBub24tY3VzdG9kaWFsKSBhbmQgdGhlIHJlY2lwaWVudCBzaWducwpgY2xhaW1fcGF5b3V0YCB0byB3aXRoZHJhdyBpdCB0byB0aGVpciBvd24gd2FsbGV0LgAAAAAJQ2xhaW1hYmxlAAAAAAAAAgAAAAYAAAAT",
        "AAAAAAAAAMVXaGF0IGBtZW1iZXJgIG11c3QgYWN0dWFsbHkgc2VuZCB0byBjb250cmlidXRlOiB0aGUgZml4ZWQgYW1vdW50IHBsdXMgYW55CmxhdGUgZmVlIHRoZXkgaGF2ZSBhY2NydWVkLiBUaGUgVUkgbmVlZHMgdGhpcyBzbyB0aGUgY29uZmlybWF0aW9uIHNjcmVlbgptYXRjaGVzIHdoYXQgdGhlIHdhbGxldCB3aWxsIGJlIGFza2VkIHRvIHRyYW5zZmVyLgAAAAAAAAphbW91bnRfZHVlAAAAAAACAAAAAAAAAAhncm91cF9pZAAAAAYAAAAAAAAABm1lbWJlcgAAAAAAEwAAAAEAAAPpAAAACwAAAAM=",
        "AAAAAAAAAQxBIG1lbWJlciBjb250cmlidXRlcyB0aGUgZml4ZWQgYW1vdW50IGZvciB0aGUgY3VycmVudCBjeWNsZS4gVGhlIG1lbWJlcgphdXRob3JpemVzIHdpdGggdGhlaXIgY29ubmVjdGVkIHdhbGxldDsgdGhlIHRva2VuIGlzIHB1bGxlZCBpbnRvIHRoZQpjb250cmFjdCdzIG93biBiYWxhbmNlIChlc2Nyb3cpLiBCaW5kcyBpZGVudGl0eSB0byBhdXRob3JpdHk6IHRoZQpzaWduZXIgbXVzdCBhbHJlYWR5IGJlIGEgbWVtYmVyIG9mIFRISVMgZ3JvdXAgKGludmFyaWFudCAjOCkuAAAACmNvbnRyaWJ1dGUAAAAAAAIAAAAAAAAACGdyb3VwX2lkAAAABgAAAAAAAAAGbWVtYmVyAAAAAAATAAAAAQAAA+kAAAPtAAAAAAAAAAM=",
        "AAAAAAAAAEBXaGV0aGVyIGEgbWVtYmVyIGhhcyBiZWVuIHJlbW92ZWQgZnJvbSB0aGUgcm90YXRpb24gKGRlZmF1bHRlZCkuAAAACmlzX3JlbW92ZWQAAAAAAAIAAAAAAAAACGdyb3VwX2lkAAAABgAAAAAAAAAGbWVtYmVyAAAAAAATAAAAAQAAAAE=",
        "AAAAAAAAAIpPcmdhbml6ZXIgYWRtaXRzIGEgbmV3IG1lbWJlci4gT25seSBhbGxvd2VkIHdoaWxlIHRoZSBncm91cCBpcyBzdGlsbApmb3JtaW5nIChEcmFmdC9PcGVuKSBzbyB0aGUgcm90YXRpb24gb3JkZXIgaXMgZml4ZWQgYmVmb3JlIGFueSBtb25leS4AAAAAAApqb2luX2dyb3VwAAAAAAACAAAAAAAAAAhncm91cF9pZAAAAAYAAAAAAAAABm1lbWJlcgAAAAAAEwAAAAEAAAPpAAAD7QAAAAAAAAAD",
        "AAAAAAAAAAAAAAALZ2V0X21lbWJlcnMAAAAAAQAAAAAAAAAIZ3JvdXBfaWQAAAAGAAAAAQAAA+oAAAAT",
        "AAAAAAAAAF5BY2NydWVkIGxhdGUtZmVlIGRlYnQgKHRva2VuIHN0cm9vcHMpIHRoYXQgd2lsbCBiZSBuZXR0ZWQgb3V0IG9mIHRoZQptZW1iZXIncyBldmVudHVhbCBwYXlvdXQuAAAAAAALbGF0ZV9mZWVfb2YAAAAAAgAAAAAAAAAIZ3JvdXBfaWQAAAAGAAAAAAAAAAZtZW1iZXIAAAAAABMAAAABAAAACw==",
        "AAAAAAAAAIFPcmdhbml6ZXIgc3RhcnRzIHRoZSBmaXJzdCBjeWNsZSwgbG9ja2luZyB0aGUgcm90YXRpb24gb3JkZXIuIFJlcXVpcmVzCmF0IGxlYXN0IHR3byBtZW1iZXJzIChhIG9uZS1wZXJzb24gY2lyY2xlIGlzIG1lYW5pbmdsZXNzKS4AAAAAAAALc3RhcnRfY3ljbGUAAAAAAQAAAAAAAAAIZ3JvdXBfaWQAAAAGAAAAAQAAA+kAAAPtAAAAAAAAAAM=",
        "AAAAAAAAAJNBbW91bnQgKHRva2VuIHN0cm9vcHMpIHRoaXMgbWVtYmVyIGlzIG93ZWQgYW5kIGNhbiBgY2xhaW1fcGF5b3V0YC4gMCBtZWFucwpub3RoaW5nIHRvIGNsYWltLiBUaGUgV2l0aGRyYXcgc2NyZWVuIHJlYWRzIHRoaXMgdG8gc2hvdyBhIGNsYWltIGJ1dHRvbi4AAAAADGNsYWltYWJsZV9vZgAAAAIAAAAAAAAACGdyb3VwX2lkAAAABgAAAAAAAAAGbWVtYmVyAAAAAAATAAAAAQAAAAs=",
        "AAAAAAAAA+ZDbGFpbSBhIHBheW91dCB0aGF0IGEgY29tcGxldGVkIGN5Y2xlIGVhcm1hcmtlZCBmb3IgYG1lbWJlcmAsIHNlbmRpbmcgaXQKdG8gYHRvYCDigJQgdGhlICJXaXRoZHJhdyIgYWN0aW9uIGZvciBhIGNpcmNsZSBwYXlvdXQuCgpOb24tY3VzdG9kaWFsOiB0aGUgZnVuZHMgd2VyZSBoZWxkIGJ5IHRoZSBjb250cmFjdCwgbmV2ZXIgYnkgU2FqaSwgYW5kCm9ubHkgbW92ZSBvbiB0aGUgbWVtYmVyJ3Mgb3duIHNpZ25hdHVyZS4gYG1lbWJlci5yZXF1aXJlX2F1dGgoKWAgbWVhbnMKbmFtaW5nIGEgZGVzdGluYXRpb24gaXMgdGhlIG1lbWJlcidzIGNob2ljZSBhbG9uZSDigJQgbm9ib2R5IGVsc2UgY2FuCnJlZGlyZWN0IHRoZWlyIHBheW91dC4gYHRvYCBpcyBkZWxpYmVyYXRlbHkgdW5yZXN0cmljdGVkIHNvIGEgbWVtYmVyIGNhbgp3aXRoZHJhdyBzdHJhaWdodCB0byBhbnkgd2FsbGV0IHRoZXkgY2hvb3NlOyBpdCBtYXkgZXF1YWwgYG1lbWJlcmAuCgpUaGUgY2xhaW1hYmxlIGVudHJ5IHN0YXlzIGtleWVkIG9uIGBtZW1iZXJgIChub3QgYHRvYCksIHNvIGEgY2xhaW0gdG8gYQp0aGlyZCBwYXJ0eSBzdGlsbCBjbGVhcnMgdGhlIHJpZ2h0IGJhbGFuY2UgYW5kIGNhbid0IGJlIHJlcGxheWVkLgoKVGhlIG9uZSBkZXN0aW5hdGlvbiB0aGF0IGlzIHJlamVjdGVkIGlzIHRoZSBjb250cmFjdCBpdHNlbGY6IHRoYXQgd291bGQKY2xlYXIgdGhlIGNsYWltIHdoaWxlIHRoZSB0b2tlbnMgbmV2ZXIgbW92ZWQsIGRlc3Ryb3lpbmcgdGhlIHBheW91dC4KCk5vdGU6IGlmIGB0b2AgaG9sZHMgbm8gdHJ1c3RsaW5lIGZvciB0aGUgZ3JvdXAncyB0b2tlbiB0aGUgdHJhbnNmZXIKcGFuaWNzIGFuZCB0aGUgd2hvbGUgY2xhaW0gcmV2ZXJ0cyDigJQgdGhlIHBheW91dCBzdGF5cyBlc2Nyb3dlZCBhbmQKY2xhaW1hYmxlLCBzbyBub3RoaW5nIGlzIGxvc3QuIENhbGxlcnMgc2hvdWxkIGNoZWNrIGZpcnN0LgoKUmV0dXJucyB0aGUgY2xhaW1lZCBhbW91bnQgKHN0cm9vcHMpLgAAAAAADGNsYWltX3BheW91dAAAAAMAAAAAAAAACGdyb3VwX2lkAAAABgAAAAAAAAAGbWVtYmVyAAAAAAATAAAAAAAAAAJ0bwAAAAAAEwAAAAEAAAPpAAAACwAAAAM=",
        "AAAAAAAAAIpDcmVhdGUgYSBzYXZpbmdzIGdyb3VwLiBUaGUgb3JnYW5pemVyIGJlY29tZXMgbWVtYmVyICMxLiBSZXR1cm5zIHRoZQpuZXcgYGdyb3VwX2lkYC4gVGhlIG9yZ2FuaXplciBhdXRob3JpemVzIHRoaXMgY2FsbCB3aXRoIHRoZWlyIHdhbGxldC4AAAAAAAxjcmVhdGVfZ3JvdXAAAAAJAAAAAAAAAAlvcmdhbml6ZXIAAAAAAAATAAAAAAAAAAV0b2tlbgAAAAAAABMAAAAAAAAABmFtb3VudAAAAAAACwAAAAAAAAAMY3ljbGVfbGVuZ3RoAAAABgAAAAAAAAAHZmVlX2JwcwAAAAAEAAAAAAAAAAxsYXRlX2ZlZV9icHMAAAAEAAAAAAAAAAxncmFjZV9wZXJpb2QAAAAGAAAAAAAAAAxwYXlvdXRfb3JkZXIAAAfQAAAAC1BheW91dE9yZGVyAAAAAAAAAAAMbGF0ZV9wZW5hbHR5AAAH0AAAAAtMYXRlUGVuYWx0eQAAAAABAAAD6QAAAAYAAAAD",
        "AAAAAQAAAAAAAAAAAAAAC0dyb3VwQ29uZmlnAAAAAAsAAAAAAAAABmFtb3VudAAAAAAACwAAAAAAAAAMY3ljbGVfbGVuZ3RoAAAABgAAAAAAAAAHZmVlX2JwcwAAAAAEAAAAfVNlY29uZHMgYWZ0ZXIgYSBjb250cmlidXRpb24ncyBkdWUgdGltZSBhIG1lbWJlciBtYXkgc3RpbGwgcGF5IGJlZm9yZQpjb3VudGluZyBhcyBhIGRlZmF1bHQuIFN0b3JlZCBmb3IgdGhlIHNhbWUgZnV0dXJlIGhvb2suAAAAAAAADGdyYWNlX3BlcmlvZAAAAAYAAACNUGVuYWx0eSBhIGxhdGUgcGF5ZXIgb3dlcywgaW4gYnBzIG9mIGBhbW91bnRgLiBTdG9yZWQgZm9yIHRoZSBkb2N1bWVudGVkCmRlZmF1bHQtaGFuZGxpbmcgaG9vayAoU1BFQyDCpzcpOyBub3QgeWV0IGNoYXJnZWQgaW4gdGhlIHN0cmljdCBNVlAuAAAAAAAADGxhdGVfZmVlX2JwcwAAAAQAAAB5V2hhdCBoYXBwZW5zIG9uIGEgbWlzc2VkIGNvbnRyaWJ1dGlvbiAoc2VlIGBMYXRlUGVuYWx0eWApLiBSZWNvcmRlZCBub3c7CmVuZm9yY2VkIGJ5IHRoZSBmdXR1cmUgZGVmYXVsdC1oYW5kbGluZyB1cGdyYWRlLgAAAAAAAAxsYXRlX3BlbmFsdHkAAAfQAAAAC0xhdGVQZW5hbHR5AAAAAAAAAAAMbWVtYmVyX2NvdW50AAAABAAAAAAAAAAJb3JnYW5pemVyAAAAAAAAEwAAAD1Sb3RhdGlvbi1vcmRlciBwb2xpY3kgY2hvc2VuIGF0IGNyZWF0aW9uIChzZWUgYFBheW91dE9yZGVyYCkuAAAAAAAADHBheW91dF9vcmRlcgAAB9AAAAALUGF5b3V0T3JkZXIAAAAAAAAAAAZzdGF0dXMAAAAAB9AAAAAGU3RhdHVzAAAAAAAAAAAABXRva2VuAAAAAAAAEw==",
        "AAAAAwAAAnRXaGF0IGhhcHBlbnMgdG8gYSBtZW1iZXIgd2hvIG1pc3NlcyBhIGNvbnRyaWJ1dGlvbiBwYXN0IHRoZSBncmFjZSBwZXJpb2QuCkJvdGggYXJlIG5vdyBlbmZvcmNlZCBieSBgcmVzb2x2ZV9kZWZhdWx0YCAob3JnYW5pemVyLWdhdGVkKToKLSBgRGVkdWN0RnJvbUJhbGFuY2VgOiBhY2NydWUgYSBsYXRlIGZlZSAoYnBzIG9mIGBhbW91bnRgKSB0aGF0IGlzIGxhdGVyCnN1YnRyYWN0ZWQgZnJvbSB0aGUgbWVtYmVyJ3Mgb3duIHBheW91dCBhbmQgcGFpZCB0byB0aGUgb3JnYW5pemVyLgotIGBSZW1vdmVNZW1iZXJgOiBtYXJrIHRoZSBtZW1iZXIgZGVmYXVsdGVkIOKAlCB0aGV5IGFyZSBza2lwcGVkIGZvciBhbGwKZnV0dXJlIGNvbnRyaWJ1dGlvbnMgQU5EIHRoZWlyIG93biBwYXlvdXQgdHVybiwgYW5kIHdoYXRldmVyIHRoZXkgaGFkCmFscmVhZHkgcGFpZCBpbnRvIHRoZSBwb29sIGlzIHJlZnVuZGVkIHRvIHRoZWlyIHdhbGxldC4KYHJlc29sdmVfZGVmYXVsdGAgYWxzbyBhdXRvLXJlbW92ZXMgQU5ZIGRlZmF1bHRlciB3aG9zZSB3YWxsZXQgY2FuIG5vIGxvbmdlcgpjb3ZlciB0aGUgY29udHJpYnV0aW9uLCByZWdhcmRsZXNzIG9mIHRoaXMgc2V0dGluZyAoImVtcHR5IHdhbGxldCDih5Igb3V0IikuAAAAAAAAAAtMYXRlUGVuYWx0eQAAAAACAAAARERlZHVjdCB0aGUgbGF0ZSBmZWUgZnJvbSB3aGF0IHRoZSBkZWZhdWx0ZXIgaXMgb3dlZCAvIHRoZWlyIGJhbGFuY2UuAAAAEURlZHVjdEZyb21CYWxhbmNlAAAAAAAAAAAAAD1SZW1vdmUgdGhlIGRlZmF1bHRlciBmcm9tIHRoZSBjaXJjbGUgaWYgdGhleSBjYW5ub3QgY292ZXIgaXQuAAAAAAAADFJlbW92ZU1lbWJlcgAAAAE=",
        "AAAAAwAAAflIb3cgdGhlIHBheW91dCByb3RhdGlvbiBvcmRlciBpcyBkZWNpZGVkLiBUaGUgY29udHJhY3QgYWx3YXlzIHBheXMgdGhlCm1lbWJlciBhdCBgQ3ljbGVgJ3MgaW5kZXggaW4gdGhlIGBNZW1iZXJzYCB2ZWM7IHRoaXMgZmllbGQgcmVjb3JkcyB0aGUKcG9saWN5IHRoZSBvcmdhbml6ZXIgY2hvc2Ugb2ZmLWNoYWluIHNvIGl0IGlzIGF1ZGl0YWJsZSBvbi1jaGFpbiBhbmQgc28gYQpmdXR1cmUgdXBncmFkZSBjYW4gZW5mb3JjZSBvcmRlcmluZyAoZS5nLiBhIHZlcmlmaWFibGUgcmFuZG9tIHNodWZmbGUpLgpIb3cgdGhlIHBheW91dCByb3RhdGlvbiBvcmRlciBpcyBkZWNpZGVkLiBUaGUgY29udHJhY3QgcGF5cyB0aGUgbWVtYmVyIGF0CmBDeWNsZWAncyBpbmRleCBpbiB0aGUgYE1lbWJlcnNgIHZlYzsgd2l0aCBgTWFudWFsYCB0aGUgb3JnYW5pemVyIGNhbiBzZXQKdGhhdCBvcmRlciBleHBsaWNpdGx5IHZpYSBgc2V0X3BheW91dF9vcmRlcmAgYmVmb3JlIHRoZSBjeWNsZSBzdGFydHMuAAAAAAAAAAAAAAtQYXlvdXRPcmRlcgAAAAAEAAAAAAAAAAZNYW51YWwAAAAAAAAAAAAAAAAABlJhbmRvbQAAAAAAAQAAAAAAAAAEVm90ZQAAAAIAAAAAAAAABkN1c3RvbQAAAAAAAw==",
        "AAAAAAAAAL9UaGUgYWRkcmVzcyB0aGF0IHdpbGwgcmVjZWl2ZSB0aGUgY3VycmVudCBjeWNsZSdzIHBheW91dDogdGhlIGZpcnN0Cm1lbWJlciBpbiByb3RhdGlvbiBvcmRlciB3aG8gaXMgYWN0aXZlIChub3QgZGVmYXVsdGVkKSBhbmQgaGFzIG5vdCB5ZXQKcmVjZWl2ZWQuIE1pcnJvcnMgdGhlIHNlbGVjdGlvbiBpbiBgdHJpZ2dlcl9wYXlvdXRgLgAAAAAObmV4dF9yZWNpcGllbnQAAAAAAAEAAAAAAAAACGdyb3VwX2lkAAAABgAAAAEAAAPpAAAAEwAAAAM=",
        "AAAAAAAABABQYXkgdGhlIGN1cnJlbnQgY3ljbGUncyByZWNpcGllbnQuIENhbGxhYmxlIGJ5IGFueW9uZSAoZS5nLiB0aGUgYmFja2VuZApzY2hlZHVsZXIpIHNpbmNlIGl0IGNhbiBvbmx5IGV2ZXIgcGF5IHRoZSBydWxlcy1kZXRlcm1pbmVkIHJlY2lwaWVudC4KClN0cmljdC1idXQtZmFpciBjb21wbGV0ZW5lc3M6IGV2ZXJ5IG1lbWJlciB3aG8gaXMgc3RpbGwgQUNUSVZFIChub3QKZGVmYXVsdGVkKSBtdXN0IGhhdmUgcGFpZCB0aGlzIGN5Y2xlLiBEZWZhdWx0ZWQgbWVtYmVycyBhcmUgc2tpcHBlZCDigJQgdGhlCm9yZ2FuaXplciByZW1vdmVzIHRoZW0gdmlhIGByZXNvbHZlX2RlZmF1bHRgIGZpcnN0LCB3aGljaCBhbHNvIHJlZnVuZHMKd2hhdCB0aGV5IGhhZCBwYWlkLCBzbyB0aGVpciBhYnNlbmNlIG5ldmVyIGJsb2NrcyB0aGUgY2lyY2xlLgoKVGhlIHJlY2lwaWVudCBpcyB0aGUgbmV4dCBtZW1iZXIgaW4gcm90YXRpb24gb3JkZXIgd2hvIGhhcyBOT1QgYWxyZWFkeQpyZWNlaXZlZCBBTkQgaXMgTk9UIGRlZmF1bHRlZC4gQW55IGxhdGUtZmVlIGRlYnQgdGhleSBhY2NydWVkIGlzIG5ldHRlZApvdXQgb2YgdGhlaXIgcGF5b3V0IGFuZCBzZW50IHRvIHRoZSBvcmdhbml6ZXIuCgpQVUxMLUJBU0VEOiB0aGUgcmVjaXBpZW50J3MgbmV0IGlzIE5PVCBwdXNoZWQgdG8gdGhlaXIgd2FsbGV0IGhlcmUuCkluc3RlYWQgaXQgaXMgcmVjb3JkZWQgYXMgYSBjbGFpbWFibGUgYmFsYW5jZSAoZnVuZHMgc3RheSBlc2Nyb3dlZCBpbiB0aGUKY29udHJhY3Qg4oCUIG5vbi1jdXN0b2RpYWwpIGFuZCB0aGUgcmVjaXBpZW50IHNpZ25zIGBjbGFpbV9wYXlvdXRgIHRvCndpdGhkcmF3IGl0LiBPbmx5IHRoZSBzZXJ2aWNlL2xhdGUgZmVlIGlzIHRyYW5zZmVycmVkIG91dCBpbW1lZGlhdGVseSwgdG8KdGhlIG9yZ2FuaXplci4gVGhpcyBtYWtlcyB0aGUgV2l0aGRyYXcvQ2xhaW0gYWN0aW9uIHRoZSB3YXkgYSBtZW1iZXIKcmVjZWl2ZXMgdGhlaXIgdHVybidzIG1vbmV5LCB3aGlsZSBrZWVwaW5nIGN1c3RvZHkgaW4gdGhlAAAADnRyaWdnZXJfcGF5b3V0AAAAAAABAAAAAAAAAAhncm91cF9pZAAAAAYAAAABAAAD6QAAA+0AAAAAAAAAAw==",
        "AAAAAAAAAAAAAAAPaGFzX2NvbnRyaWJ1dGVkAAAAAAMAAAAAAAAACGdyb3VwX2lkAAAABgAAAAAAAAAFY3ljbGUAAAAAAAAEAAAAAAAAAAZtZW1iZXIAAAAAABMAAAABAAAAAQ==",
        "AAAAAAAAAztPcmdhbml6ZXIgcmVzb2x2ZXMgYSBtZW1iZXIgd2hvIGhhcyBtaXNzZWQgdGhlIGN1cnJlbnQgY3ljbGUgcGFzdCB0aGUKZ3JhY2UgcGVyaW9kLiBFbmZvcmNlcyB0aGUgdHdvLXBhcnQgcnVsZSBmcm9tIHRoZSBwcm9kdWN0IGRlc2lnbjoKCiogSWYgdGhlIG1lbWJlcidzIHdhbGxldCBjYW4gbm8gbG9uZ2VyIGNvdmVyIHRoZSBjb250cmlidXRpb24gKGVtcHR5CndhbGxldCksIHRoZXkgYXJlIFJFTU9WRUQgcmVnYXJkbGVzcyBvZiB0aGUgZ3JvdXAncyBwZW5hbHR5IHBvbGljeSDigJQKbWFya2VkIGRlZmF1bHRlZCwgc2tpcHBlZCBpbiBhbGwgZnV0dXJlIGN5Y2xlcyBhbmQgdGhlaXIgb3duIHBheW91dAp0dXJuLCBhbmQgZXZlcnl0aGluZyB0aGV5IGhhZCBhbHJlYWR5IHBhaWQgaW4gaXMgUkVGVU5ERUQgdG8gdGhlbS4KKiBPdGhlcndpc2UsIGFwcGx5IHRoZSBncm91cCdzIGBsYXRlX3BlbmFsdHlgOgotIGBSZW1vdmVNZW1iZXJgICAg4oaSIHJlbW92ZSArIHJlZnVuZCAoYXMgYWJvdmUpLgotIGBEZWR1Y3RGcm9tQmFsYW5jZWAg4oaSIGFjY3J1ZSBhIGxhdGUgZmVlIChicHMgb2YgYGFtb3VudGApIHRoYXQgaXMKbGF0ZXIgbmV0dGVkIG91dCBvZiB0aGUgbWVtYmVyJ3Mgb3duIHBheW91dCB0byB0aGUgb3JnYW5pemVyLgoKT3JnYW5pemVyLWdhdGVkLiBPbmx5IHZhbGlkIHdoaWxlIEFjdGl2ZSwgb25seSB3aGVuIHRoZSBncmFjZSBwZXJpb2QKKGBjeWNsZV9sZW5ndGggKyBncmFjZV9wZXJpb2RgIHNlY29uZHMgc2luY2UgdGhlIGN5Y2xlJ3Mgc3RhcnQpIGhhcwplbGFwc2VkIGFuZCB0aGUgbWVtYmVyIGhhcyBOT1QgcGFpZCB0aGlzIGN5Y2xlLgAAAAAPcmVzb2x2ZV9kZWZhdWx0AAAAAAIAAAAAAAAACGdyb3VwX2lkAAAABgAAAAAAAAAGbWVtYmVyAAAAAAATAAAAAQAAA+kAAAPtAAAAAAAAAAM=",
        "AAAAAAAAAUhMZWRnZXIgdGltZXN0YW1wIGF0IHdoaWNoIFRISVMgY3ljbGUncyBkZXBvc2l0cyBvcGVuZWQgKG9yIHdpbGwgb3BlbikuCgpBIGN5Y2xlIGNhbiBzZXR0bGUgd2VsbCBiZWZvcmUgaXRzIGxlbmd0aCBlbGFwc2VzLCBzbyB0aGUgbmV4dCByb3VuZCdzCmRlcG9zaXQgd2luZG93IGlzIHdoYXQgY2FycmllcyB0aGUgc2NoZWR1bGUuIFRoZSBVSSBuZWVkcyB0aGlzIHRvIHNob3cKIm5leHQgY29udHJpYnV0aW9uIG9wZW5zIGluIC4uLiIgcmF0aGVyIHRoYW4gbGV0dGluZyBhIG1lbWJlciBzaWduIGEKdHJhbnNhY3Rpb24gdGhhdCByZXZlcnRzIHdpdGggYEN5Y2xlTm90T3BlbmAuAAAAEGRlcG9zaXRzX29wZW5fYXQAAAABAAAAAAAAAAhncm91cF9pZAAAAAYAAAABAAAABg==",
        "AAAAAAAAAaNPcmdhbml6ZXIgc2V0cyB0aGUgZXhhY3QgcGF5b3V0IHJvdGF0aW9uIG9yZGVyICh0aGUgZHJhZy1hbmQtZHJvcCAid2hvCmdldHMgcGFpZCBmaXJzdCIgZmVhdHVyZSkuIE9ubHkgdmFsaWQgd2hpbGUgdGhlIGdyb3VwIGlzIHN0aWxsIGZvcm1pbmcKKERyYWZ0L09wZW4pIGFuZCBvbmx5IHdoZW4gdGhlIGdyb3VwJ3MgcG9saWN5IGlzIGBNYW51YWxgLiBUaGUgcHJvcG9zZWQKYG9yZGVyYCBtdXN0IGJlIGEgcGVybXV0YXRpb24gb2YgdGhlIGN1cnJlbnQgbWVtYmVycyDigJQgc2FtZSBsZW5ndGgsIGV2ZXJ5CmN1cnJlbnQgbWVtYmVyIHByZXNlbnQgZXhhY3RseSBvbmNlIOKAlCBzbyBubyBvbmUgaXMgZHJvcHBlZCBvciBpbmplY3RlZC4KVGhlIG9yZGVyIGlzIGZyb3plbiB3aGVuIGBzdGFydF9jeWNsZWAgbG9ja3MgdGhlIGdyb3VwLgAAAAAQc2V0X3BheW91dF9vcmRlcgAAAAIAAAAAAAAACGdyb3VwX2lkAAAABgAAAAAAAAAFb3JkZXIAAAAAAAPqAAAAEwAAAAEAAAPpAAAD7QAAAAAAAAAD",
        "AAAAAAAAAuNPbmUtc2hvdCBsYXVuY2g6IGFkbWl0IHRoZSBmdWxsIG1lbWJlciByb3N0ZXIgaW4gdGhlIGNob3NlbiBwYXlvdXQgb3JkZXIKQU5EIHN0YXJ0IHRoZSBmaXJzdCBjeWNsZSwgaW4gYSBTSU5HTEUgb3JnYW5pemVyLXNpZ25lZCB0cmFuc2FjdGlvbi4gVGhpcwppcyB0aGUgIlN0YXJ0IENpcmNsZSIgYWN0aW9uIOKAlCBpbnN0ZWFkIG9mIGFkbWl0dGluZyBlYWNoIGpvaW5lciBvbi1jaGFpbgoob25lIHNpZ25hdHVyZSBlYWNoKSB0aGVuIHN0YXJ0aW5nLCB0aGUgb3JnYW5pemVyIGFjY2VwdHMgbWVtYmVycyBpbiB0aGUKYXBwIChvZmYtY2hhaW4pIGFuZCBsYXVuY2hlcyBldmVyeW9uZSBhdCBvbmNlIGhlcmUuCgpgb3JkZXJgIGlzIHRoZSBjb21wbGV0ZSByb3RhdGlvbjogZXZlcnkgbWVtYmVyIChpbmNsdWRpbmcgdGhlIG9yZ2FuaXplcikKZXhhY3RseSBvbmNlLCBpbiBwYXlvdXQgb3JkZXIgKGluZGV4ID0gcGF5b3V0IHBvc2l0aW9uKS4gSXQgcmVwbGFjZXMgdGhlCm1lbWJlciBsaXN0IHdob2xlc2FsZSwgc28gaXQgbXVzdDoKLSBjb250YWluIHRoZSBvcmdhbml6ZXIsCi0gaGF2ZSDiiaUgMiBlbnRyaWVzIGFuZCDiiaQgTUFYX01FTUJFUlMsCi0gaGF2ZSBubyBkdXBsaWNhdGVzLgpWYWxpZCBvbmx5IHdoaWxlIHRoZSBncm91cCBpcyBzdGlsbCBmb3JtaW5nIChEcmFmdC9PcGVuKS4gQWZ0ZXIgdGhpcyB0aGUKZ3JvdXAgaXMgQWN0aXZlIGFuZCB0aGUgcm9zdGVyL29yZGVyIGFyZSBsb2NrZWQuAAAAABJzdGFydF93aXRoX21lbWJlcnMAAAAAAAIAAAAAAAAACGdyb3VwX2lkAAAABgAAAAAAAAAFb3JkZXIAAAAAAAPqAAAAEwAAAAEAAAPpAAAD7QAAAAAAAAAD" ]),
      options
    )
  }
  public readonly fromJSON = {
    get_pool: this.txFromJSON<i128>,
        get_cycle: this.txFromJSON<u32>,
        get_group: this.txFromJSON<Result<GroupConfig>>,
        amount_due: this.txFromJSON<Result<i128>>,
        contribute: this.txFromJSON<Result<void>>,
        is_removed: this.txFromJSON<boolean>,
        join_group: this.txFromJSON<Result<void>>,
        get_members: this.txFromJSON<Array<string>>,
        late_fee_of: this.txFromJSON<i128>,
        start_cycle: this.txFromJSON<Result<void>>,
        claimable_of: this.txFromJSON<i128>,
        claim_payout: this.txFromJSON<Result<i128>>,
        create_group: this.txFromJSON<Result<u64>>,
        next_recipient: this.txFromJSON<Result<string>>,
        trigger_payout: this.txFromJSON<Result<void>>,
        has_contributed: this.txFromJSON<boolean>,
        resolve_default: this.txFromJSON<Result<void>>,
        deposits_open_at: this.txFromJSON<u64>,
        set_payout_order: this.txFromJSON<Result<void>>,
        start_with_members: this.txFromJSON<Result<void>>
  }
}