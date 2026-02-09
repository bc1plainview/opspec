# opspec Examples — Annotated Contract Patterns

## 1. Bonding Curve (DeFi)

A bonding curve contract for token launches with graduation mechanics.

```typescript
/// @invariant this.virtualPillReserve.value > u256.Zero
/// @invariant this.virtualTokenReserve.value > u256.Zero
/// @invariant this.k.value == SafeMath.mul(initialPillReserve, initialTokenReserve)
/// @opnet selectors-sha256
/// @opnet no-approve
/// @state UNINITIALIZED -> ACTIVE : setTokenAddress()
/// @state ACTIVE -> GRADUATED : buy() [when realPillAccumulated >= graduationThreshold]
/// @state !GRADUATED -> !GRADUATED : buy(), sell()
@final
export class BondingCurve extends OP_NET {

    /// @access deployer-only
    /// @pre !this.initialized.value  // "Token address already set"
    public setTokenAddress(calldata: Calldata): BytesWriter { ... }

    /// @access anyone
    /// @pre !this.graduated.value           // "Token has graduated"
    /// @pre this.initialized.value          // "Contract not initialized"
    /// @pre !calldata.readU256().isZero()  // "Amount must be non-zero"
    /// @post this.virtualPillReserve.value >= old(this.virtualPillReserve.value)
    /// @post this.virtualTokenReserve.value <= old(this.virtualTokenReserve.value)
    /// @post return.readU256() > u256.Zero
    /// @calls this.pillAddress.value : transferFrom(sender, this, amount) -> must-succeed
    /// @ensures CEI
    public buy(calldata: Calldata): BytesWriter { ... }

    /// @access anyone
    /// @pre !this.graduated.value
    /// @pre this.initialized.value
    /// @post this.virtualPillReserve.value <= old(this.virtualPillReserve.value)
    /// @post this.virtualTokenReserve.value >= old(this.virtualTokenReserve.value)
    /// @calls this.pillAddress.value : transfer(sender, pillOut) -> must-succeed
    /// @ensures CEI
    public sell(calldata: Calldata): BytesWriter { ... }
}
```

## 2. Dead Man's Switch (Safety)

A heartbeat-based switch with state machine semantics.

```typescript
/// @invariant this.heartbeatInterval.value > u256.Zero
/// @invariant this.gracePeriod.value > u256.Zero
/// @state ACTIVE -> TRIGGERED : trigger() [when currentBlock > lastCheckin + heartbeatInterval]
/// @state TRIGGERED -> ACTIVE : cancel() [when currentBlock <= triggerBlock + gracePeriod]
/// @state ACTIVE -> ACTIVE : checkin(), storeData(), updateBeneficiary()
/// @temporal checkin() must be called within this.heartbeatInterval.value blocks
@final
export class DeadMansSwitch extends OP_NET {

    /// @access owner-only
    /// @pre this.status.value == STATUS_ACTIVE
    /// @post this.lastCheckin.value == Blockchain.block.numberU256
    public checkin(_calldata: Calldata): BytesWriter { ... }

    /// @access anyone
    /// @pre this.status.value == STATUS_ACTIVE
    /// @pre currentBlock > SafeMath.add(lastCheckin, heartbeatInterval)
    /// @post this.status.value == STATUS_TRIGGERED
    public trigger(_calldata: Calldata): BytesWriter { ... }

    /// @access owner-only
    /// @pre this.status.value == STATUS_TRIGGERED
    /// @pre currentBlock <= SafeMath.add(triggerBlock, gracePeriod)
    /// @post this.status.value == STATUS_ACTIVE
    public cancel(_calldata: Calldata): BytesWriter { ... }
}
```

## 3. NFT Marketplace (Trading)

A multi-tenant NFT marketplace with listings and bids.

```typescript
/// @invariant this.platformFeeBps.value <= u256.fromU32(500)  // Max 5%
/// @invariant this.nextListingId.value >= u256.One
/// @opnet selectors-sha256
/// @opnet no-approve
@final
export class NFTMarketplace extends OP_NET {

    /// @access anyone
    /// @pre !collectionAddr.isZero()
    /// @pre price > u256.Zero
    /// @post this.nextListingId.value > old(this.nextListingId.value)
    /// @calls collection : ownerOf(tokenId) -> must-succeed
    /// @calls collection : isApprovedForAll(sender, this) -> must-succeed
    private listNFT(calldata: Calldata): BytesWriter { ... }

    /// @access anyone
    /// @pre buyer != seller  // "Buyer cannot be seller"
    /// @post this.totalVolume.value >= old(this.totalVolume.value)
    /// @calls collection : safeTransferFrom(seller, buyer, tokenId) -> must-succeed
    /// @ensures CEI
    private buyNFT(calldata: Calldata): BytesWriter { ... }

    /// @access deployer-only
    /// @pre !collectionAddr.isZero()
    /// @pre royaltyBps <= MAX_ROYALTY_BPS
    private registerCollection(calldata: Calldata): BytesWriter { ... }

    /// @access deployer-only
    /// @pre newFeeBps <= MAX_PLATFORM_FEE_BPS
    private setPlatformFee(calldata: Calldata): BytesWriter { ... }
}
```

## 4. Token with Allowances (ERC20-style)

```typescript
/// @invariant totalSupply == sum(balances)  // V2: needs quantifier support
/// @opnet selectors-sha256
/// @opnet no-approve
/// @opnet address-two-params
@final
export class OP20Token extends OP_20 {

    /// @access anyone
    /// @pre amount > u256.Zero
    /// @post balanceOf(sender) == old(balanceOf(sender)) - amount
    /// @post balanceOf(recipient) == old(balanceOf(recipient)) + amount
    /// @ensures CEI
    public transfer(calldata: Calldata): BytesWriter { ... }

    /// @access anyone
    /// @pre allowance(sender, spender) >= amount
    /// @post allowance(sender, spender) == old(allowance) - amount
    public transferFrom(calldata: Calldata): BytesWriter { ... }
}
```

## 5. Access Control Patterns

### Deployer-only
```typescript
/// @access deployer-only
public setFee(calldata: Calldata): BytesWriter {
    this.onlyDeployer(Blockchain.tx.sender);  // ← verifier checks for this
    // ...
}
```

### Owner-only (custom owner field)
```typescript
/// @access owner-only
public updateConfig(calldata: Calldata): BytesWriter {
    this.ensureOwner();  // ← verifier checks for this
    // ...
}
```

### Anyone (no restrictions)
```typescript
/// @access anyone
public getStatus(_calldata: Calldata): BytesWriter {
    // No access control — verifier confirms no onlyDeployer/ensureOwner calls
    // ...
}
```

## 6. CEI Pattern

The `@ensures CEI` annotation checks that all state writes occur before external calls:

```typescript
/// @ensures CEI
public buy(calldata: Calldata): BytesWriter {
    // ✓ CHECKS: validate inputs
    if (amount.isZero()) throw new Revert('Zero amount');

    // ✓ EFFECTS: update state
    this.balance.value = SafeMath.add(this.balance.value, amount);

    // ✓ INTERACTIONS: external calls
    const result = Blockchain.call(target, data);
    if (!result.success) throw new Revert('Call failed');

    return writer;
}
```

A violation would be:
```typescript
/// @ensures CEI
public deposit(calldata: Calldata): BytesWriter {
    // Interaction FIRST — VIOLATION!
    const result = Blockchain.call(target, data);

    // State write AFTER external call — CEI violated!
    this.balance.value = SafeMath.add(this.balance.value, amount);  // ← VIOLATED

    return writer;
}
```
