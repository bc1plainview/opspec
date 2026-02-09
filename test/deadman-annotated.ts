// ============================================================================
// Test: Dead Man's Switch with opspec Annotations
// ============================================================================

import { u256 } from '@btc-vision/as-bignum/assembly';
import {
    Address,
    Blockchain,
    BytesWriter,
    Calldata,
    encodePointer,
    EMPTY_POINTER,
    OP_NET,
    Revert,
    SafeMath,
    StoredAddress,
    StoredU256,
} from '@btc-vision/btc-runtime/runtime';

const STATUS_ACTIVE: u256 = u256.Zero;
const STATUS_TRIGGERED: u256 = u256.One;
const STATUS_CANCELLED: u256 = u256.fromU32(2);

/// @invariant this.heartbeatInterval.value > u256.Zero
/// @invariant this.gracePeriod.value > u256.Zero
/// @state ACTIVE -> TRIGGERED : trigger() [when currentBlock > lastCheckin + heartbeatInterval]
/// @state TRIGGERED -> ACTIVE : cancel() [when currentBlock <= triggerBlock + gracePeriod]
/// @state ACTIVE -> ACTIVE : checkin(), storeData(), updateBeneficiary(), updateInterval()
/// @temporal checkin() must be called within this.heartbeatInterval.value blocks
@final
export class DeadMansSwitch extends OP_NET {
    private readonly lastCheckinPointer: u16 = Blockchain.nextPointer;
    private readonly heartbeatIntervalPointer: u16 = Blockchain.nextPointer;
    private readonly gracePeriodPointer: u16 = Blockchain.nextPointer;
    private readonly statusPointer: u16 = Blockchain.nextPointer;
    private readonly chunkCountPointer: u16 = Blockchain.nextPointer;
    private readonly triggerBlockPointer: u16 = Blockchain.nextPointer;
    private readonly ownerPointer: u16 = Blockchain.nextPointer;
    private readonly beneficiaryPointer: u16 = Blockchain.nextPointer;

    private readonly lastCheckin: StoredU256 = new StoredU256(this.lastCheckinPointer, EMPTY_POINTER);
    private readonly heartbeatInterval: StoredU256 = new StoredU256(this.heartbeatIntervalPointer, EMPTY_POINTER);
    private readonly gracePeriod: StoredU256 = new StoredU256(this.gracePeriodPointer, EMPTY_POINTER);
    private readonly status: StoredU256 = new StoredU256(this.statusPointer, EMPTY_POINTER);
    private readonly chunkCount: StoredU256 = new StoredU256(this.chunkCountPointer, EMPTY_POINTER);
    private readonly triggerBlock: StoredU256 = new StoredU256(this.triggerBlockPointer, EMPTY_POINTER);
    private readonly owner: StoredAddress = new StoredAddress(this.ownerPointer);
    private readonly beneficiary: StoredAddress = new StoredAddress(this.beneficiaryPointer);

    public constructor() {
        super();
    }

    /// @access owner-only
    /// @pre this.status.value == STATUS_ACTIVE  // "Switch must be active"
    /// @post this.lastCheckin.value == Blockchain.block.numberU256
    public checkin(_calldata: Calldata): BytesWriter {
        this.ensureOwner();
        this.ensureActive();

        const currentBlock: u256 = Blockchain.block.numberU256;
        this.lastCheckin.value = currentBlock;

        const writer: BytesWriter = new BytesWriter(1);
        writer.writeBoolean(true);
        return writer;
    }

    /// @access anyone
    /// @pre this.status.value == STATUS_ACTIVE  // "Switch must be active"
    /// @pre currentBlock > lastCheckin + heartbeatInterval  // "Heartbeat not expired"
    /// @post this.status.value == STATUS_TRIGGERED
    /// @post this.triggerBlock.value == Blockchain.block.numberU256
    public trigger(_calldata: Calldata): BytesWriter {
        const currentStatus: u256 = this.status.value;
        if (u256.eq(currentStatus, STATUS_TRIGGERED)) {
            throw new Revert('Switch already triggered');
        }

        if (u256.eq(currentStatus, STATUS_CANCELLED)) {
            throw new Revert('Switch has been cancelled');
        }

        const currentBlock: u256 = Blockchain.block.numberU256;
        const lastCheck: u256 = this.lastCheckin.value;
        const interval: u256 = this.heartbeatInterval.value;
        const deadline: u256 = SafeMath.add(lastCheck, interval);

        if (currentBlock <= deadline) {
            throw new Revert('Heartbeat has not expired yet');
        }

        this.status.value = STATUS_TRIGGERED;
        this.triggerBlock.value = currentBlock;

        const writer: BytesWriter = new BytesWriter(1);
        writer.writeBoolean(true);
        return writer;
    }

    /// @access owner-only
    /// @pre this.status.value == STATUS_TRIGGERED  // "Switch must be triggered"
    /// @pre currentBlock <= triggerBlock + gracePeriod  // "Grace period not expired"
    /// @post this.status.value == STATUS_ACTIVE
    /// @post this.lastCheckin.value == Blockchain.block.numberU256
    public cancel(_calldata: Calldata): BytesWriter {
        this.ensureOwner();

        const currentStatus: u256 = this.status.value;
        if (!u256.eq(currentStatus, STATUS_TRIGGERED)) {
            throw new Revert('Switch is not triggered');
        }

        const currentBlock: u256 = Blockchain.block.numberU256;
        const trigBlock: u256 = this.triggerBlock.value;
        const grace: u256 = this.gracePeriod.value;
        const graceDeadline: u256 = SafeMath.add(trigBlock, grace);

        if (currentBlock > graceDeadline) {
            throw new Revert('Grace period has expired');
        }

        this.status.value = STATUS_ACTIVE;
        this.lastCheckin.value = currentBlock;
        this.triggerBlock.value = u256.Zero;

        const writer: BytesWriter = new BytesWriter(1);
        writer.writeBoolean(true);
        return writer;
    }

    /// @access owner-only
    /// @pre this.status.value == STATUS_ACTIVE  // "Switch must be active"
    /// @pre !newBeneficiary.isZero()  // "Beneficiary cannot be zero"
    public updateBeneficiary(calldata: Calldata): BytesWriter {
        this.ensureOwner();
        this.ensureActive();

        const newBeneficiary: Address = calldata.readAddress();
        if (newBeneficiary.equals(Address.zero())) {
            throw new Revert('Beneficiary cannot be zero address');
        }

        this.beneficiary.value = newBeneficiary;

        const writer: BytesWriter = new BytesWriter(1);
        writer.writeBoolean(true);
        return writer;
    }

    /// @access owner-only
    /// @pre this.status.value == STATUS_ACTIVE  // "Switch must be active"
    /// @pre !newInterval.isZero()  // "Interval must be > 0"
    public updateInterval(calldata: Calldata): BytesWriter {
        this.ensureOwner();
        this.ensureActive();

        const newInterval: u256 = calldata.readU256();
        if (newInterval.isZero()) {
            throw new Revert('Interval must be greater than zero');
        }

        this.heartbeatInterval.value = newInterval;

        const writer: BytesWriter = new BytesWriter(1);
        writer.writeBoolean(true);
        return writer;
    }

    /// @access anyone
    /// @pre this.status.value == STATUS_TRIGGERED  // "Switch must be triggered"
    public getDecryptionKey(_calldata: Calldata): BytesWriter {
        const currentStatus: u256 = this.status.value;
        if (!u256.eq(currentStatus, STATUS_TRIGGERED)) {
            throw new Revert('Switch has not been triggered');
        }

        const writer: BytesWriter = new BytesWriter(32);
        writer.writeU256(u256.Zero);
        return writer;
    }

    private ensureOwner(): void {
        const ownerAddr: Address = this.owner.value;
        if (!Blockchain.tx.sender.equals(ownerAddr)) {
            throw new Revert('Only owner can call this method');
        }
    }

    private ensureActive(): void {
        const currentStatus: u256 = this.status.value;
        if (!u256.eq(currentStatus, STATUS_ACTIVE)) {
            throw new Revert('Switch is not active');
        }
    }
}
