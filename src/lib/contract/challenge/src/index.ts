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
  /**
   * Deposit or withdrawal amount was zero or negative.
   */
  1: {message:"InvalidAmount"},
  /**
   * The member has no balance in this challenge, or asked for more than they
   * hold. Withdrawing is capped at what you put in (invariant #2).
   */
  2: {message:"InsufficientBalance"},
  /**
   * A deposit named a different token than the challenge already holds.
   * Balances are denominated in one token; mixing them would make the
   * recorded figures meaningless.
   */
  3: {message:"WrongToken"},
  /**
   * The withdrawal destination is the contract itself. That would clear the
   * balance while the tokens never left, destroying the savings with no way
   * to recover them.
   */
  4: {message:"InvalidDestination"},
  /**
   * A transfer would exceed what the contract actually holds. Catches
   * bookkeeping drifting above reality before it can spend another
   * challenge's escrow (invariant #3).
   */
  5: {message:"InsufficientEscrow"}
}

/**
 * Storage keys. Every balance key carries the `challenge_id` so funds for one
 * challenge can never be addressed by another (invariant #1).
 */
export type DataKey = {tag: "Token", values: readonly [u64, string]} | {tag: "Balance", values: readonly [u64, string]};

export interface Client {
  /**
   * Construct and simulate a deposit transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Save `amount` toward a challenge. The member authorizes with their own
   * wallet and the token is pulled into the contract (escrow), credited to
   * their personal balance.
   * 
   * No membership check happens here: joining a challenge is an app-level,
   * off-chain concept with no money attached, and gating deposits on it
   * would mean trusting an on-chain member list this contract has no reason
   * to maintain. Depositing to a challenge you haven't joined credits you
   * normally and is harmless — the funds remain yours and withdrawable.
   * 
   * `challenge_id` is the app's group id, so the app can address a
   * challenge's balances without extra bookkeeping here.
   */
  deposit: ({challenge_id, member, token, amount}: {challenge_id: u64, member: string, token: string, amount: i128}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a token_of transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * The token this member's savings in this challenge are denominated in, or
   * None before their first deposit. Read-only.
   */
  token_of: ({challenge_id, member}: {challenge_id: u64, member: string}, options?: MethodOptions) => Promise<AssembledTransaction<Option<string>>>

  /**
   * Construct and simulate a withdraw transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Withdraw `amount` of the member's own savings to `to`.
   * 
   * UNCONDITIONAL by design: there is no target check, no deadline, and no
   * status. Whether the member reached their goal, gave up, or simply
   * changed their mind, the money is theirs and this is the same code path.
   * The only rule is that you cannot take out more than you put in.
   * 
   * `member.require_auth()` means naming a destination is the member's
   * choice alone — nobody else can redirect their savings. `to` is otherwise
   * unrestricted so they can withdraw straight to any wallet they choose;
   * it may equal `member`.
   * 
   * The balance stays keyed on `member` (not `to`), so a withdrawal to a
   * third party still debits the right account and can't be replayed.
   * 
   * Note: if `to` holds no trustline for the challenge's token the transfer
   * panics and the whole withdrawal reverts — the savings stay escrowed, so
   * nothing is lost. Callers should check first.
   * 
   * Returns the member's remaining balance.
   */
  withdraw: ({challenge_id, member, to, amount}: {challenge_id: u64, member: string, to: string, amount: i128}, options?: MethodOptions) => Promise<AssembledTransaction<Result<i128>>>

  /**
   * Construct and simulate a balance_of transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * How much this member currently has saved in this challenge. Read-only.
   * 
   * This is the app's source of truth for progress: the figure is the money
   * itself, not a record of it, so it cannot disagree with reality.
   */
  balance_of: ({challenge_id, member}: {challenge_id: u64, member: string}, options?: MethodOptions) => Promise<AssembledTransaction<i128>>

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
      new ContractSpec([ "AAAAAAAAAnpTYXZlIGBhbW91bnRgIHRvd2FyZCBhIGNoYWxsZW5nZS4gVGhlIG1lbWJlciBhdXRob3JpemVzIHdpdGggdGhlaXIgb3duCndhbGxldCBhbmQgdGhlIHRva2VuIGlzIHB1bGxlZCBpbnRvIHRoZSBjb250cmFjdCAoZXNjcm93KSwgY3JlZGl0ZWQgdG8KdGhlaXIgcGVyc29uYWwgYmFsYW5jZS4KCk5vIG1lbWJlcnNoaXAgY2hlY2sgaGFwcGVucyBoZXJlOiBqb2luaW5nIGEgY2hhbGxlbmdlIGlzIGFuIGFwcC1sZXZlbCwKb2ZmLWNoYWluIGNvbmNlcHQgd2l0aCBubyBtb25leSBhdHRhY2hlZCwgYW5kIGdhdGluZyBkZXBvc2l0cyBvbiBpdAp3b3VsZCBtZWFuIHRydXN0aW5nIGFuIG9uLWNoYWluIG1lbWJlciBsaXN0IHRoaXMgY29udHJhY3QgaGFzIG5vIHJlYXNvbgp0byBtYWludGFpbi4gRGVwb3NpdGluZyB0byBhIGNoYWxsZW5nZSB5b3UgaGF2ZW4ndCBqb2luZWQgY3JlZGl0cyB5b3UKbm9ybWFsbHkgYW5kIGlzIGhhcm1sZXNzIOKAlCB0aGUgZnVuZHMgcmVtYWluIHlvdXJzIGFuZCB3aXRoZHJhd2FibGUuCgpgY2hhbGxlbmdlX2lkYCBpcyB0aGUgYXBwJ3MgZ3JvdXAgaWQsIHNvIHRoZSBhcHAgY2FuIGFkZHJlc3MgYQpjaGFsbGVuZ2UncyBiYWxhbmNlcyB3aXRob3V0IGV4dHJhIGJvb2trZWVwaW5nIGhlcmUuAAAAAAAHZGVwb3NpdAAAAAAEAAAAAAAAAAxjaGFsbGVuZ2VfaWQAAAAGAAAAAAAAAAZtZW1iZXIAAAAAABMAAAAAAAAABXRva2VuAAAAAAAAEwAAAAAAAAAGYW1vdW50AAAAAAALAAAAAQAAA+kAAAPtAAAAAAAAAAM=",
        "AAAABAAAAAAAAAAAAAAABUVycm9yAAAAAAAABQAAADJEZXBvc2l0IG9yIHdpdGhkcmF3YWwgYW1vdW50IHdhcyB6ZXJvIG9yIG5lZ2F0aXZlLgAAAAAADUludmFsaWRBbW91bnQAAAAAAAABAAAAh1RoZSBtZW1iZXIgaGFzIG5vIGJhbGFuY2UgaW4gdGhpcyBjaGFsbGVuZ2UsIG9yIGFza2VkIGZvciBtb3JlIHRoYW4gdGhleQpob2xkLiBXaXRoZHJhd2luZyBpcyBjYXBwZWQgYXQgd2hhdCB5b3UgcHV0IGluIChpbnZhcmlhbnQgIzIpLgAAAAATSW5zdWZmaWNpZW50QmFsYW5jZQAAAAACAAAAo0EgZGVwb3NpdCBuYW1lZCBhIGRpZmZlcmVudCB0b2tlbiB0aGFuIHRoZSBjaGFsbGVuZ2UgYWxyZWFkeSBob2xkcy4KQmFsYW5jZXMgYXJlIGRlbm9taW5hdGVkIGluIG9uZSB0b2tlbjsgbWl4aW5nIHRoZW0gd291bGQgbWFrZSB0aGUKcmVjb3JkZWQgZmlndXJlcyBtZWFuaW5nbGVzcy4AAAAACldyb25nVG9rZW4AAAAAAAMAAACgVGhlIHdpdGhkcmF3YWwgZGVzdGluYXRpb24gaXMgdGhlIGNvbnRyYWN0IGl0c2VsZi4gVGhhdCB3b3VsZCBjbGVhciB0aGUKYmFsYW5jZSB3aGlsZSB0aGUgdG9rZW5zIG5ldmVyIGxlZnQsIGRlc3Ryb3lpbmcgdGhlIHNhdmluZ3Mgd2l0aCBubyB3YXkKdG8gcmVjb3ZlciB0aGVtLgAAABJJbnZhbGlkRGVzdGluYXRpb24AAAAAAAQAAACjQSB0cmFuc2ZlciB3b3VsZCBleGNlZWQgd2hhdCB0aGUgY29udHJhY3QgYWN0dWFsbHkgaG9sZHMuIENhdGNoZXMKYm9va2tlZXBpbmcgZHJpZnRpbmcgYWJvdmUgcmVhbGl0eSBiZWZvcmUgaXQgY2FuIHNwZW5kIGFub3RoZXIKY2hhbGxlbmdlJ3MgZXNjcm93IChpbnZhcmlhbnQgIzMpLgAAAAASSW5zdWZmaWNpZW50RXNjcm93AAAAAAAF",
        "AAAAAAAAAHRUaGUgdG9rZW4gdGhpcyBtZW1iZXIncyBzYXZpbmdzIGluIHRoaXMgY2hhbGxlbmdlIGFyZSBkZW5vbWluYXRlZCBpbiwgb3IKTm9uZSBiZWZvcmUgdGhlaXIgZmlyc3QgZGVwb3NpdC4gUmVhZC1vbmx5LgAAAAh0b2tlbl9vZgAAAAIAAAAAAAAADGNoYWxsZW5nZV9pZAAAAAYAAAAAAAAABm1lbWJlcgAAAAAAEwAAAAEAAAPoAAAAEw==",
        "AAAAAAAAA6VXaXRoZHJhdyBgYW1vdW50YCBvZiB0aGUgbWVtYmVyJ3Mgb3duIHNhdmluZ3MgdG8gYHRvYC4KClVOQ09ORElUSU9OQUwgYnkgZGVzaWduOiB0aGVyZSBpcyBubyB0YXJnZXQgY2hlY2ssIG5vIGRlYWRsaW5lLCBhbmQgbm8Kc3RhdHVzLiBXaGV0aGVyIHRoZSBtZW1iZXIgcmVhY2hlZCB0aGVpciBnb2FsLCBnYXZlIHVwLCBvciBzaW1wbHkKY2hhbmdlZCB0aGVpciBtaW5kLCB0aGUgbW9uZXkgaXMgdGhlaXJzIGFuZCB0aGlzIGlzIHRoZSBzYW1lIGNvZGUgcGF0aC4KVGhlIG9ubHkgcnVsZSBpcyB0aGF0IHlvdSBjYW5ub3QgdGFrZSBvdXQgbW9yZSB0aGFuIHlvdSBwdXQgaW4uCgpgbWVtYmVyLnJlcXVpcmVfYXV0aCgpYCBtZWFucyBuYW1pbmcgYSBkZXN0aW5hdGlvbiBpcyB0aGUgbWVtYmVyJ3MKY2hvaWNlIGFsb25lIOKAlCBub2JvZHkgZWxzZSBjYW4gcmVkaXJlY3QgdGhlaXIgc2F2aW5ncy4gYHRvYCBpcyBvdGhlcndpc2UKdW5yZXN0cmljdGVkIHNvIHRoZXkgY2FuIHdpdGhkcmF3IHN0cmFpZ2h0IHRvIGFueSB3YWxsZXQgdGhleSBjaG9vc2U7Cml0IG1heSBlcXVhbCBgbWVtYmVyYC4KClRoZSBiYWxhbmNlIHN0YXlzIGtleWVkIG9uIGBtZW1iZXJgIChub3QgYHRvYCksIHNvIGEgd2l0aGRyYXdhbCB0byBhCnRoaXJkIHBhcnR5IHN0aWxsIGRlYml0cyB0aGUgcmlnaHQgYWNjb3VudCBhbmQgY2FuJ3QgYmUgcmVwbGF5ZWQuCgpOb3RlOiBpZiBgdG9gIGhvbGRzIG5vIHRydXN0bGluZSBmb3IgdGhlIGNoYWxsZW5nZSdzIHRva2VuIHRoZSB0cmFuc2ZlcgpwYW5pY3MgYW5kIHRoZSB3aG9sZSB3aXRoZHJhd2FsIHJldmVydHMg4oCUIHRoZSBzYXZpbmdzIHN0YXkgZXNjcm93ZWQsIHNvCm5vdGhpbmcgaXMgbG9zdC4gQ2FsbGVycyBzaG91bGQgY2hlY2sgZmlyc3QuCgpSZXR1cm5zIHRoZSBtZW1iZXIncyByZW1haW5pbmcgYmFsYW5jZS4AAAAAAAAId2l0aGRyYXcAAAAEAAAAAAAAAAxjaGFsbGVuZ2VfaWQAAAAGAAAAAAAAAAZtZW1iZXIAAAAAABMAAAAAAAAAAnRvAAAAAAATAAAAAAAAAAZhbW91bnQAAAAAAAsAAAABAAAD6QAAAAsAAAAD",
        "AAAAAgAAAIdTdG9yYWdlIGtleXMuIEV2ZXJ5IGJhbGFuY2Uga2V5IGNhcnJpZXMgdGhlIGBjaGFsbGVuZ2VfaWRgIHNvIGZ1bmRzIGZvciBvbmUKY2hhbGxlbmdlIGNhbiBuZXZlciBiZSBhZGRyZXNzZWQgYnkgYW5vdGhlciAoaW52YXJpYW50ICMxKS4AAAAAAAAAAAdEYXRhS2V5AAAAAAIAAAABAAADPyhjaGFsbGVuZ2VfaWQsIG1lbWJlcikgLT4gdGhlIHRva2VuIFRISVMgTUVNQkVSIHNhdmVzIGluLiBTZXQgYnkgdGhlaXIKZmlyc3QgZGVwb3NpdCBhbmQgaW1tdXRhYmxlIHRoZXJlYWZ0ZXIsIHNvIGEgbGF0ZXIgZGVwb3NpdCBjYW5ub3QgbWl4IGEKc2Vjb25kIGFzc2V0IGludG8gYSBiYWxhbmNlIGZpZ3VyZSBkZW5vbWluYXRlZCBpbiB0aGUgZmlyc3QuCgpLZXllZCBwZXIgbWVtYmVyLCBub3QgcGVyIGNoYWxsZW5nZS4gQSBjaGFsbGVuZ2Utd2lkZSBrZXkgbWFkZSB0aGUgdG9rZW4KZmlyc3Qtd3JpdGVyLXdpbnMgYWNyb3NzIEFMTCBtZW1iZXJzLCBhbmQgYGRlcG9zaXRgIGhhcyBubyBtZW1iZXJzaGlwIG9yCmV4aXN0ZW5jZSBjaGVjayB3aGlsZSBgY2hhbGxlbmdlX2lkYCBpcyB0aGUgYXBwJ3Mgc2VxdWVudGlhbCBncm91cCBpZCDigJQKc28gYW55b25lIGNvdWxkIGRlcG9zaXQgMSBzdHJvb3Agb2YgYSB3b3J0aGxlc3Mgc2VsZi1pc3N1ZWQgdG9rZW4gaW50bwpjaGFsbGVuZ2UgTisxLCBOKzIsIC4uLiBiZWZvcmUgdGhlIHJlYWwgbWVtYmVycyBhcnJpdmVkLCBwZXJtYW5lbnRseQpwaW5uaW5nIHRob3NlIGNoYWxsZW5nZXMgdG8ganVuay4gRXZlcnkgbGVnaXRpbWF0ZSBkZXBvc2l0IHRoZW4gZmFpbGVkCndpdGggV3JvbmdUb2tlbiwgd2l0aCBubyBhZG1pbiBvdmVycmlkZSBhbmQgbm8gd2F5IHRvIHJlc2V0LiBQZXItbWVtYmVyCmtleWluZyBwcmVzZXJ2ZXMgdGhlIGFjdHVhbCBpbnZhcmlhbnQgKG9uZSBtZW1iZXIncyBiYWxhbmNlIGlzIGluIG9uZQphc3NldCkgd2hpbGUgbWFraW5nIHRoZSBncmllZmluZyBzZWxmLWluZmxpY3RlZCBvbmx5LgAAAAAFVG9rZW4AAAAAAAACAAAABgAAABMAAAABAAAArShjaGFsbGVuZ2VfaWQsIG1lbWJlcikgLT4gaG93IG11Y2ggdGhpcyBtZW1iZXIgY3VycmVudGx5IGhhcyBlc2Nyb3dlZC4KSW5jcmVhc2VzIG9uIGRlcG9zaXQsIGRlY3JlYXNlcyBvbiB3aXRoZHJhd2FsLiBUaGlzIGlzIHRoZSBPTkxZIHJlY29yZApvZiBvd25lcnNoaXA7IHRoZXJlIGlzIG5vIHBvb2wuAAAAAAAAB0JhbGFuY2UAAAAAAgAAAAYAAAAT",
        "AAAAAAAAAM9Ib3cgbXVjaCB0aGlzIG1lbWJlciBjdXJyZW50bHkgaGFzIHNhdmVkIGluIHRoaXMgY2hhbGxlbmdlLiBSZWFkLW9ubHkuCgpUaGlzIGlzIHRoZSBhcHAncyBzb3VyY2Ugb2YgdHJ1dGggZm9yIHByb2dyZXNzOiB0aGUgZmlndXJlIGlzIHRoZSBtb25leQppdHNlbGYsIG5vdCBhIHJlY29yZCBvZiBpdCwgc28gaXQgY2Fubm90IGRpc2FncmVlIHdpdGggcmVhbGl0eS4AAAAACmJhbGFuY2Vfb2YAAAAAAAIAAAAAAAAADGNoYWxsZW5nZV9pZAAAAAYAAAAAAAAABm1lbWJlcgAAAAAAEwAAAAEAAAAL" ]),
      options
    )
  }
  public readonly fromJSON = {
    deposit: this.txFromJSON<Result<void>>,
        token_of: this.txFromJSON<Option<string>>,
        withdraw: this.txFromJSON<Result<i128>>,
        balance_of: this.txFromJSON<i128>
  }
}