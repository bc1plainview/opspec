// ============================================================================
// Test: OpSea NFT Marketplace with opspec Annotations
// ============================================================================
//
// Spec annotations for the OPNet NFT Marketplace contract showing how
// opspec works with a real-world marketplace contract.

import { u256 } from '@btc-vision/as-bignum/assembly';
import {
    Address,
    AddressMemoryMap,
    Blockchain,
    BytesWriter,
    Calldata,
    encodeSelector,
    OP_NET,
    Revert,
    SafeMath,
    Selector,
    StoredAddress,
    StoredMapU256,
    StoredU256,
    EMPTY_POINTER,
} from '@btc-vision/btc-runtime/runtime';

import { CallResult } from '@btc-vision/btc-runtime/runtime/env/BlockchainEnvironment';

/// @invariant this.platformFeeBps.value <= u256.fromU32(500)  // Max 5%
/// @invariant this.nextListingId.value >= u256.One  // IDs start at 1
/// @invariant this.nextBidId.value >= u256.One
/// @opnet selectors-sha256
/// @opnet no-approve
@final
export class NFTMarketplace extends OP_NET {
    private readonly safeTransferFromSelector: Selector = encodeSelector('safeTransferFrom');
    private readonly isApprovedForAllSelector: Selector = encodeSelector('isApprovedForAll');
    private readonly ownerOfSelector: Selector = encodeSelector('ownerOf');

    private readonly listNFTSelector: Selector = encodeSelector('listNFT');
    private readonly cancelListingSelector: Selector = encodeSelector('cancelListing');
    private readonly buyNFTSelector: Selector = encodeSelector('buyNFT');
    private readonly registerCollectionSelector: Selector = encodeSelector('registerCollection');
    private readonly setPlatformFeeSelector: Selector = encodeSelector('setPlatformFee');

    private readonly nextListingIdPointer: u16 = Blockchain.nextPointer;
    private readonly listingCollectionPointer: u16 = Blockchain.nextPointer;
    private readonly listingTokenIdPointer: u16 = Blockchain.nextPointer;
    private readonly listingSellerPointer: u16 = Blockchain.nextPointer;
    private readonly listingPricePointer: u16 = Blockchain.nextPointer;
    private readonly listingActivePointer: u16 = Blockchain.nextPointer;
    private readonly platformFeeBpsPointer: u16 = Blockchain.nextPointer;
    private readonly platformFeeRecipientPointer: u16 = Blockchain.nextPointer;
    private readonly totalVolumePointer: u16 = Blockchain.nextPointer;
    private readonly totalListingsPointer: u16 = Blockchain.nextPointer;

    private readonly nextListingId: StoredU256 = new StoredU256(this.nextListingIdPointer, EMPTY_POINTER);
    private readonly listingCollectionMap: StoredMapU256 = new StoredMapU256(this.listingCollectionPointer);
    private readonly listingTokenIdMap: StoredMapU256 = new StoredMapU256(this.listingTokenIdPointer);
    private readonly listingSellerMap: StoredMapU256 = new StoredMapU256(this.listingSellerPointer);
    private readonly listingPriceMap: StoredMapU256 = new StoredMapU256(this.listingPricePointer);
    private readonly listingActiveMap: StoredMapU256 = new StoredMapU256(this.listingActivePointer);
    private readonly platformFeeBps: StoredU256 = new StoredU256(this.platformFeeBpsPointer, EMPTY_POINTER);
    private readonly platformFeeRecipient: StoredAddress = new StoredAddress(this.platformFeeRecipientPointer);
    private readonly totalVolume: StoredU256 = new StoredU256(this.totalVolumePointer, EMPTY_POINTER);
    private readonly totalListings: StoredU256 = new StoredU256(this.totalListingsPointer, EMPTY_POINTER);

    private readonly ACTIVE: u256 = u256.One;
    private readonly INACTIVE: u256 = u256.Zero;
    private readonly MAX_PLATFORM_FEE_BPS: u256 = u256.fromU32(500);

    public constructor() {
        super();
    }

    public override execute(method: Selector, calldata: Calldata): BytesWriter {
        switch (method) {
            case this.listNFTSelector:
                return this.listNFT(calldata);
            case this.cancelListingSelector:
                return this.cancelListing(calldata);
            case this.buyNFTSelector:
                return this.buyNFT(calldata);
            case this.registerCollectionSelector:
                return this.registerCollection(calldata);
            case this.setPlatformFeeSelector:
                return this.setPlatformFee(calldata);
            default:
                return super.execute(method, calldata);
        }
    }

    /// @access anyone
    /// @pre !collectionAddr.isZero()  // "Invalid collection address"
    /// @pre price > u256.Zero  // "Price must be greater than zero"
    /// @post this.nextListingId.value > old(this.nextListingId.value)
    /// @post this.totalListings.value > old(this.totalListings.value)
    /// @calls collection : ownerOf(tokenId) -> must-succeed
    /// @calls collection : isApprovedForAll(sender, this) -> must-succeed
    private listNFT(calldata: Calldata): BytesWriter {
        const collectionAddr: Address = calldata.readAddress();
        const tokenId: u256 = calldata.readU256();
        const price: u256 = calldata.readU256();
        const sender: Address = Blockchain.tx.sender;

        if (collectionAddr.isZero()) {
            throw new Revert('Invalid collection address');
        }

        if (u256.eq(price, u256.Zero)) {
            throw new Revert('Price must be greater than zero');
        }

        this.verifyOwnership(collectionAddr, tokenId, sender);
        this.verifyApproval(collectionAddr, sender);

        const listingId: u256 = this.nextListingId.value;
        this.nextListingId.value = SafeMath.add(listingId, u256.One);

        this.listingCollectionMap.set(listingId, this.addressToU256(collectionAddr));
        this.listingTokenIdMap.set(listingId, tokenId);
        this.listingSellerMap.set(listingId, this.addressToU256(sender));
        this.listingPriceMap.set(listingId, price);
        this.listingActiveMap.set(listingId, this.ACTIVE);

        this.totalListings.value = SafeMath.add(this.totalListings.value, u256.One);

        const writer: BytesWriter = new BytesWriter(32);
        writer.writeU256(listingId);
        return writer;
    }

    /// @access anyone
    /// @pre sender == seller  // "Only seller can cancel"
    /// @post listingActiveMap.get(listingId) == INACTIVE
    private cancelListing(calldata: Calldata): BytesWriter {
        const listingId: u256 = calldata.readU256();
        const sender: Address = Blockchain.tx.sender;

        this.requireActiveListing(listingId);

        const sellerU256: u256 = this.listingSellerMap.get(listingId);
        const seller: Address = this.u256ToAddress(sellerU256);

        if (!sender.equals(seller)) {
            throw new Revert('Only seller can cancel');
        }

        this.listingActiveMap.set(listingId, this.INACTIVE);

        const writer: BytesWriter = new BytesWriter(1);
        writer.writeBoolean(true);
        return writer;
    }

    /// @access anyone
    /// @pre buyer != seller  // "Buyer cannot be seller"
    /// @post this.totalVolume.value >= old(this.totalVolume.value)
    /// @calls collection : safeTransferFrom(seller, buyer, tokenId) -> must-succeed
    /// @ensures CEI
    private buyNFT(calldata: Calldata): BytesWriter {
        const listingId: u256 = calldata.readU256();
        const buyer: Address = Blockchain.tx.sender;

        this.requireActiveListing(listingId);

        const collectionAddr: Address = this.u256ToAddress(this.listingCollectionMap.get(listingId));
        const tokenId: u256 = this.listingTokenIdMap.get(listingId);
        const seller: Address = this.u256ToAddress(this.listingSellerMap.get(listingId));
        const price: u256 = this.listingPriceMap.get(listingId);

        if (buyer.equals(seller)) {
            throw new Revert('Buyer cannot be seller');
        }

        // Effects before interactions (CEI)
        this.listingActiveMap.set(listingId, this.INACTIVE);
        this.totalVolume.value = SafeMath.add(this.totalVolume.value, price);

        // Interaction
        this.executeNFTTransfer(collectionAddr, seller, buyer, tokenId);

        const writer: BytesWriter = new BytesWriter(1);
        writer.writeBoolean(true);
        return writer;
    }

    /// @access deployer-only
    /// @pre !collectionAddr.isZero()  // "Invalid collection address"
    private registerCollection(calldata: Calldata): BytesWriter {
        this.onlyDeployer(Blockchain.tx.sender);

        const collectionAddr: Address = calldata.readAddress();
        if (collectionAddr.isZero()) {
            throw new Revert('Invalid collection address');
        }

        const writer: BytesWriter = new BytesWriter(1);
        writer.writeBoolean(true);
        return writer;
    }

    /// @access deployer-only
    /// @pre newFeeBps <= MAX_PLATFORM_FEE_BPS  // "Fee exceeds maximum"
    private setPlatformFee(calldata: Calldata): BytesWriter {
        this.onlyDeployer(Blockchain.tx.sender);

        const newFeeBps: u256 = calldata.readU256();

        if (u256.gt(newFeeBps, this.MAX_PLATFORM_FEE_BPS)) {
            throw new Revert('Fee exceeds maximum 5%');
        }

        this.platformFeeBps.value = newFeeBps;

        const writer: BytesWriter = new BytesWriter(1);
        writer.writeBoolean(true);
        return writer;
    }

    private addressToU256(addr: Address): u256 {
        return u256.fromUint8ArrayBE(addr);
    }

    private u256ToAddress(val: u256): Address {
        return Address.fromUint8Array(val.toUint8Array(true));
    }

    private verifyOwnership(collection: Address, tokenId: u256, expectedOwner: Address): void {
        const ownerOfCalldata: BytesWriter = new BytesWriter(36);
        ownerOfCalldata.writeSelector(this.ownerOfSelector);
        ownerOfCalldata.writeU256(tokenId);

        const result: CallResult = Blockchain.call(collection, ownerOfCalldata);
        if (!result.success) {
            throw new Revert('ownerOf call failed');
        }
    }

    private verifyApproval(collection: Address, owner: Address): void {
        const approvalCalldata: BytesWriter = new BytesWriter(68);
        approvalCalldata.writeSelector(this.isApprovedForAllSelector);
        approvalCalldata.writeAddress(owner);
        approvalCalldata.writeAddress(this.address);

        const result: CallResult = Blockchain.call(collection, approvalCalldata);
        if (!result.success) {
            throw new Revert('isApprovedForAll call failed');
        }
    }

    private executeNFTTransfer(
        collection: Address,
        from: Address,
        to: Address,
        tokenId: u256,
    ): void {
        const transferCalldata: BytesWriter = new BytesWriter(100);
        transferCalldata.writeSelector(this.safeTransferFromSelector);
        transferCalldata.writeAddress(from);
        transferCalldata.writeAddress(to);
        transferCalldata.writeU256(tokenId);

        const result: CallResult = Blockchain.call(collection, transferCalldata);
        if (!result.success) {
            throw new Revert('NFT transfer failed');
        }
    }

    private requireActiveListing(listingId: u256): void {
        const currentNextId: u256 = this.nextListingId.value;
        if (u256.ge(listingId, currentNextId) || u256.eq(listingId, u256.Zero)) {
            throw new Revert('Listing does not exist');
        }

        const active: u256 = this.listingActiveMap.get(listingId);
        if (u256.eq(active, this.INACTIVE)) {
            throw new Revert('Listing is not active');
        }
    }
}
