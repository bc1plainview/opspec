// ============================================================================
// Test: Annotated Violations Contract — Specs that the code VIOLATES
// ============================================================================
//
// This contract has deliberately incorrect/missing implementations relative
// to its spec annotations. Used to test that the verifier detects violations.

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

/// @opnet no-approve
@final
export class BrokenVault extends OP_NET {
    private readonly depositSelector: Selector = encodeSelector('deposit');
    private readonly withdrawSelector: Selector = encodeSelector('withdraw');
    private readonly setFeeSelector: Selector = encodeSelector('setFee');

    private readonly balancePointer: u16 = Blockchain.nextPointer;
    private readonly feePointer: u16 = Blockchain.nextPointer;
    private readonly ownerPointer: u16 = Blockchain.nextPointer;
    private readonly tokenPointer: u16 = Blockchain.nextPointer;

    private readonly balance: StoredU256 = new StoredU256(this.balancePointer, EMPTY_POINTER);
    private readonly fee: StoredU256 = new StoredU256(this.feePointer, EMPTY_POINTER);
    private readonly owner: StoredAddress = new StoredAddress(this.ownerPointer);
    private readonly tokenAddress: StoredAddress = new StoredAddress(this.tokenPointer);

    public constructor() {
        super();
    }

    public override execute(method: Selector, calldata: Calldata): BytesWriter {
        switch (method) {
            case this.depositSelector:
                return this.deposit(calldata);
            case this.withdrawSelector:
                return this.withdraw(calldata);
            case this.setFeeSelector:
                return this.setFee(calldata);
            default:
                return super.execute(method, calldata);
        }
    }

    /// @access deployer-only
    // VIOLATION: No onlyDeployer() call!
    public setFee(calldata: Calldata): BytesWriter {
        // Missing: this.onlyDeployer(Blockchain.tx.sender);

        const newFee: u256 = calldata.readU256();
        this.fee.value = newFee;

        const writer: BytesWriter = new BytesWriter(1);
        writer.writeBoolean(true);
        return writer;
    }

    /// @access anyone
    /// @pre !calldata.readU256().isZero()  // "Amount must be non-zero"
    /// @ensures CEI
    /// @calls this.tokenAddress.value : transferFrom(sender, this, amount) -> must-succeed
    // VIOLATION: CEI pattern violated — state write AFTER external call
    public deposit(calldata: Calldata): BytesWriter {
        const amount: u256 = calldata.readU256();

        if (amount.isZero()) {
            throw new Revert('Amount must be non-zero');
        }

        const sender: Address = Blockchain.tx.sender;

        // Interaction BEFORE effects — CEI VIOLATION!
        const transferCalldata: BytesWriter = new BytesWriter(100);
        transferCalldata.writeSelector(encodeSelector('transferFrom'));
        transferCalldata.writeAddress(sender);
        transferCalldata.writeAddress(this.address);
        transferCalldata.writeU256(amount);

        const result: CallResult = Blockchain.call(this.tokenAddress.value, transferCalldata);
        if (!result.success) {
            throw new Revert('Transfer failed');
        }

        // State write AFTER external call!
        this.balance.value = SafeMath.add(this.balance.value, amount);

        const writer: BytesWriter = new BytesWriter(32);
        writer.writeU256(this.balance.value);
        return writer;
    }

    /// @access anyone
    /// @pre !calldata.readU256().isZero()  // "Amount must be non-zero"
    /// @calls this.tokenAddress.value : transfer(sender, amount) -> must-succeed
    // VIOLATION: No success check on external call
    public withdraw(calldata: Calldata): BytesWriter {
        const amount: u256 = calldata.readU256();

        if (amount.isZero()) {
            throw new Revert('Amount must be non-zero');
        }

        const sender: Address = Blockchain.tx.sender;

        // Effects before interactions (CEI OK here)
        this.balance.value = SafeMath.sub(this.balance.value, amount);

        // Interaction — but no success check!
        const transferCalldata: BytesWriter = new BytesWriter(100);
        transferCalldata.writeSelector(encodeSelector('transfer'));
        transferCalldata.writeAddress(sender);
        transferCalldata.writeU256(amount);

        // NOTE: Call result NOT checked!
        Blockchain.call(this.tokenAddress.value, transferCalldata);

        const writer: BytesWriter = new BytesWriter(32);
        writer.writeU256(this.balance.value);
        return writer;
    }
}
