// ============================================================================
// Test: Annotated Good Contract — All specs should pass verification
// ============================================================================
//
// This is a simulated OPNet bonding curve contract with correct spec annotations.
// Used to test that the opspec verifier correctly identifies VERIFIED specs.

import { u256 } from '@btc-vision/as-bignum/assembly';
import {
    Address,
    Blockchain,
    BytesWriter,
    Calldata,
    encodeSelector,
    OP_NET,
    Revert,
    SafeMath,
    Selector,
    StoredAddress,
    StoredBoolean,
    StoredU256,
    EMPTY_POINTER,
} from '@btc-vision/btc-runtime/runtime';

import { CallResult } from '@btc-vision/btc-runtime/runtime/env/BlockchainEnvironment';

/// @invariant this.virtualPillReserve.value > u256.Zero
/// @invariant this.virtualTokenReserve.value > u256.Zero
/// @opnet selectors-sha256
/// @opnet no-approve
/// @state UNINITIALIZED -> ACTIVE : setTokenAddress()
/// @state ACTIVE -> GRADUATED : buy() [when realPillAccumulated >= graduationThreshold]
/// @state !GRADUATED -> !GRADUATED : buy(), sell()
@final
export class BondingCurve extends OP_NET {
    private readonly buySelector: Selector = encodeSelector('buy');
    private readonly sellSelector: Selector = encodeSelector('sell');
    private readonly setTokenAddressSelector: Selector = encodeSelector('setTokenAddress');

    private readonly graduationThresholdPointer: u16 = Blockchain.nextPointer;
    private readonly virtualPillReservePointer: u16 = Blockchain.nextPointer;
    private readonly virtualTokenReservePointer: u16 = Blockchain.nextPointer;
    private readonly realPillAccumulatedPointer: u16 = Blockchain.nextPointer;
    private readonly kPointer: u16 = Blockchain.nextPointer;
    private readonly graduatedPointer: u16 = Blockchain.nextPointer;
    private readonly initializedPointer: u16 = Blockchain.nextPointer;
    private readonly pillAddressPointer: u16 = Blockchain.nextPointer;
    private readonly tokenAddressPointer: u16 = Blockchain.nextPointer;

    private readonly graduationThreshold: StoredU256 = new StoredU256(
        this.graduationThresholdPointer, EMPTY_POINTER,
    );
    private readonly virtualPillReserve: StoredU256 = new StoredU256(
        this.virtualPillReservePointer, EMPTY_POINTER,
    );
    private readonly virtualTokenReserve: StoredU256 = new StoredU256(
        this.virtualTokenReservePointer, EMPTY_POINTER,
    );
    private readonly realPillAccumulated: StoredU256 = new StoredU256(
        this.realPillAccumulatedPointer, EMPTY_POINTER,
    );
    private readonly k: StoredU256 = new StoredU256(this.kPointer, EMPTY_POINTER);
    private readonly graduated: StoredBoolean = new StoredBoolean(this.graduatedPointer, EMPTY_POINTER);
    private readonly initialized: StoredBoolean = new StoredBoolean(this.initializedPointer, EMPTY_POINTER);
    private readonly pillAddress: StoredAddress = new StoredAddress(this.pillAddressPointer);
    private readonly tokenAddress: StoredAddress = new StoredAddress(this.tokenAddressPointer);

    public constructor() {
        super();
    }

    public override execute(method: Selector, calldata: Calldata): BytesWriter {
        switch (method) {
            case this.buySelector:
                return this.buy(calldata);
            case this.sellSelector:
                return this.sell(calldata);
            case this.setTokenAddressSelector:
                return this.setTokenAddress(calldata);
            default:
                return super.execute(method, calldata);
        }
    }

    /// @access deployer-only
    /// @pre !this.initialized.value  // "Token address already set"
    public setTokenAddress(calldata: Calldata): BytesWriter {
        this.onlyDeployer(Blockchain.tx.sender);

        if (this.initialized.value) {
            throw new Revert('Token address already set');
        }

        const tokenAddr: Address = calldata.readAddress();
        if (tokenAddr.isZero()) {
            throw new Revert('Invalid token address');
        }

        this.tokenAddress.value = tokenAddr;
        this.initialized.value = true;

        const writer: BytesWriter = new BytesWriter(1);
        writer.writeBoolean(true);
        return writer;
    }

    /// @access anyone
    /// @pre !this.graduated.value  // "Token has graduated"
    /// @pre this.initialized.value  // "Contract not initialized"
    /// @post this.virtualPillReserve.value >= old(this.virtualPillReserve.value)
    /// @post this.virtualTokenReserve.value <= old(this.virtualTokenReserve.value)
    /// @calls pillAddress : transferFrom(sender, this, amount) -> must-succeed
    /// @ensures CEI
    public buy(calldata: Calldata): BytesWriter {
        if (this.graduated.value) {
            throw new Revert('Token has graduated');
        }
        if (!this.initialized.value) {
            throw new Revert('Contract not initialized');
        }

        const pillAmount: u256 = calldata.readU256();
        if (pillAmount.isZero()) {
            throw new Revert('PILL amount must be non-zero');
        }

        const sender: Address = Blockchain.tx.sender;

        // Calculate tokens out using constant product formula
        const newPillReserve: u256 = SafeMath.add(this.virtualPillReserve.value, pillAmount);
        const newTokenReserve: u256 = SafeMath.div(this.k.value, newPillReserve);
        const tokensOut: u256 = SafeMath.sub(this.virtualTokenReserve.value, newTokenReserve);

        // Effects first (CEI pattern)
        this.virtualPillReserve.value = newPillReserve;
        this.virtualTokenReserve.value = newTokenReserve;
        this.realPillAccumulated.value = SafeMath.add(this.realPillAccumulated.value, pillAmount);

        // Check graduation threshold
        if (u256.ge(this.realPillAccumulated.value, this.graduationThreshold.value)) {
            this.graduated.value = true;
        }

        // Interactions (external calls last)
        const transferCalldata: BytesWriter = new BytesWriter(100);
        transferCalldata.writeSelector(encodeSelector('transferFrom'));
        transferCalldata.writeAddress(sender);
        transferCalldata.writeAddress(this.address);
        transferCalldata.writeU256(pillAmount);

        const result: CallResult = Blockchain.call(this.pillAddress.value, transferCalldata);
        if (!result.success) {
            throw new Revert('PILL transfer failed');
        }

        const writer: BytesWriter = new BytesWriter(32);
        writer.writeU256(tokensOut);
        return writer;
    }

    /// @access anyone
    /// @pre !this.graduated.value  // "Token has graduated"
    /// @pre this.initialized.value  // "Contract not initialized"
    /// @ensures CEI
    public sell(calldata: Calldata): BytesWriter {
        if (this.graduated.value) {
            throw new Revert('Token has graduated');
        }
        if (!this.initialized.value) {
            throw new Revert('Contract not initialized');
        }

        const tokenAmount: u256 = calldata.readU256();
        if (tokenAmount.isZero()) {
            throw new Revert('Token amount must be non-zero');
        }

        const sender: Address = Blockchain.tx.sender;

        // Calculate PILL out
        const newTokenReserve: u256 = SafeMath.add(this.virtualTokenReserve.value, tokenAmount);
        const newPillReserve: u256 = SafeMath.div(this.k.value, newTokenReserve);
        const pillOut: u256 = SafeMath.sub(this.virtualPillReserve.value, newPillReserve);

        // Effects
        this.virtualTokenReserve.value = newTokenReserve;
        this.virtualPillReserve.value = newPillReserve;
        this.realPillAccumulated.value = SafeMath.sub(this.realPillAccumulated.value, pillOut);

        // Interactions
        const transferCalldata: BytesWriter = new BytesWriter(100);
        transferCalldata.writeSelector(encodeSelector('transfer'));
        transferCalldata.writeAddress(sender);
        transferCalldata.writeU256(pillOut);

        const result: CallResult = Blockchain.call(this.pillAddress.value, transferCalldata);
        if (!result.success) {
            throw new Revert('PILL transfer failed');
        }

        const writer: BytesWriter = new BytesWriter(32);
        writer.writeU256(pillOut);
        return writer;
    }
}
