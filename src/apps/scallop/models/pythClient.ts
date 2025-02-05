import { bcs } from '@mysten/sui.js/bcs';
import { SuiClient } from '@mysten/sui.js/client';
import { TransactionBlock } from '@mysten/sui.js/transactions';
import { SUI_CLOCK_OBJECT_ID } from '@mysten/sui.js/utils';

const MAX_ARGUMENT_SIZE = 16 * 1024;

export class PythClient {
  provider: SuiClient;

  pythStateId: string;

  wormholeStateId: string;

  private pythPackageId: any;

  private wormholePackageId: any;

  private priceTableInfo: { id: string; fieldType: string };

  private priceFeedObjectIdCache: Map<string, string> = new Map();

  private baseUpdateFee: any;

  constructor(provider: SuiClient, pythStateId: string, wormholeStateId: string) {
    this.provider = provider;
    this.pythStateId = pythStateId;
    this.wormholeStateId = wormholeStateId;
    this.pythPackageId = undefined;
    this.wormholePackageId = undefined;
  }

  async getBaseUpdateFee() {
    if (this.baseUpdateFee === undefined) {
      const result = await this.provider.getObject({
        id: this.pythStateId,
        options: { showContent: true },
      });
      if (!result.data || !result.data.content || result.data.content.dataType !== 'moveObject') {
        throw new Error('Unable to fetch pyth state object');
      }
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      this.baseUpdateFee = result.data.content.fields.base_update_fee;
    }
    return this.baseUpdateFee;
  }

  /**
   * getPackageId returns the latest package id that the object belongs to. Use this to
   * fetch the latest package id for a given object id and handle package upgrades automatically.
   * @param objectId
   * @returns package id
   */
  async getPackageId(objectId: string) {
    const state = await this.provider
      .getObject({
        id: objectId,
        options: {
          showContent: true,
        },
      })
      .then((result) => {
        if (result.data?.content?.dataType === 'moveObject') {
          return result.data.content.fields;
        }
        throw new Error(`Cannot fetch package id for object ${objectId}`);
      });
    if ('upgrade_cap' in state) {
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      return state.upgrade_cap.fields.package;
    }
    throw new Error('upgrade_cap not found');
  }

  /**
   * Adds the commands for calling wormhole and verifying the vaas and returns the verified vaas.
   * @param vaas array of vaas to verify
   * @param tx transaction block to add commands to
   */
  async verifyVaas(vaas: Buffer[], tx: TransactionBlock) {
    const wormholePackageId = await this.getWormholePackageId();
    const verifiedVaas: {
      index: number;
      resultIndex: number;
      kind: 'NestedResult';
    }[] = [];
    vaas.forEach((vaa) => {
      const [verifiedVaa] = tx.moveCall({
        target: `${wormholePackageId}::vaa::parse_and_verify`,
        arguments: [
          tx.object(this.wormholeStateId),
          tx.pure(
            bcs
              .ser('vector<u8>', Array.from(vaa), {
                maxSize: MAX_ARGUMENT_SIZE,
              })
              .toBytes(),
          ),
          tx.object(SUI_CLOCK_OBJECT_ID),
        ],
      });
      verifiedVaas.push(verifiedVaa);
    });
    return verifiedVaas;
  }

  /**
   * Adds the necessary commands for updating the pyth price feeds to the transaction block.
   * @param tx transaction block to add commands to
   * @param updates array of price feed updates received from the price service
   * @param feedIds array of feed ids to update (in hex format)
   */
  async updatePriceFeeds(tx: TransactionBlock, updates: Buffer[], feedIds: string[]) {
    const packageId = await this.getPythPackageId();
    let priceUpdatesHotPotato;
    if (updates.length > 1) {
      throw new Error('SDK does not support sending multiple accumulator messages in a single transaction');
    }
    const vaa = this.extractVaaBytesFromAccumulatorMessage(updates[0]);
    const verifiedVaas = await this.verifyVaas([vaa], tx);
    [priceUpdatesHotPotato] = tx.moveCall({
      target: `${packageId}::pyth::create_authenticated_price_infos_using_accumulator`,
      arguments: [
        tx.object(this.pythStateId),
        tx.pure(
          bcs
            .ser('vector<u8>', Array.from(updates[0]), {
              maxSize: MAX_ARGUMENT_SIZE,
            })
            .toBytes(),
        ),
        verifiedVaas[0],
        tx.object(SUI_CLOCK_OBJECT_ID),
      ],
    });
    const priceInfoObjects = [];
    const baseUpdateFee = await this.getBaseUpdateFee();
    const coins = tx.splitCoins(
      tx.gas,
      feedIds.map(() => tx.pure(baseUpdateFee)),
    );
    let coinId = 0;
    for (let i = 0; i < feedIds.length; i++) {
      const priceInfoObjectId = await this.getPriceFeedObjectId(feedIds[i]);
      if (!priceInfoObjectId) {
        throw new Error(`Price feed ${feedIds[0]} not found, please create it first`);
      }
      priceInfoObjects.push(priceInfoObjectId);
      [priceUpdatesHotPotato] = tx.moveCall({
        target: `${packageId}::pyth::update_single_price_feed`,
        arguments: [
          tx.object(this.pythStateId),
          priceUpdatesHotPotato,
          tx.object(priceInfoObjectId),
          coins[coinId],
          tx.object(SUI_CLOCK_OBJECT_ID),
        ],
      });
      coinId++;
    }
    tx.moveCall({
      target: `${packageId}::hot_potato_vector::destroy`,
      arguments: [priceUpdatesHotPotato],
      typeArguments: [`${packageId}::price_info::PriceInfo`],
    });
    return priceInfoObjects;
  }

  async createPriceFeed(tx: TransactionBlock, updates: Buffer[]) {
    const packageId = await this.getPythPackageId();
    if (updates.length > 1) {
      throw new Error('SDK does not support sending multiple accumulator messages in a single transaction');
    }
    const vaa = this.extractVaaBytesFromAccumulatorMessage(updates[0]);
    const verifiedVaas = await this.verifyVaas([vaa], tx);
    tx.moveCall({
      target: `${packageId}::pyth::create_price_feeds_using_accumulator`,
      arguments: [
        tx.object(this.pythStateId),
        tx.pure(
          bcs
            .ser('vector<u8>', Array.from(updates[0]), {
              maxSize: MAX_ARGUMENT_SIZE,
            })
            .toBytes(),
        ),
        verifiedVaas[0],
        tx.object(SUI_CLOCK_OBJECT_ID),
      ],
    });
  }

  /**
   * Get the packageId for the wormhole package if not already cached
   */
  async getWormholePackageId() {
    if (!this.wormholePackageId) {
      this.wormholePackageId = await this.getPackageId(this.wormholeStateId);
    }
    return this.wormholePackageId;
  }

  /**
   * Get the packageId for the pyth package if not already cached
   */
  async getPythPackageId() {
    if (!this.pythPackageId) {
      this.pythPackageId = await this.getPackageId(this.pythStateId);
    }
    return this.pythPackageId;
  }

  /**
   * Get the priceFeedObjectId for a given feedId if not already cached
   * @param feedId
   */
  async getPriceFeedObjectId(feedId: string) {
    const normalizedFeedId = feedId.replace('0x', '');
    if (!this.priceFeedObjectIdCache.has(normalizedFeedId)) {
      const { id: tableId, fieldType } = await this.getPriceTableInfo();
      const result = await this.provider.getDynamicFieldObject({
        parentId: tableId,
        name: {
          type: `${fieldType}::price_identifier::PriceIdentifier`,
          value: {
            bytes: Array.from(Buffer.from(normalizedFeedId, 'hex')),
          },
        },
      });
      if (!result.data || !result.data.content) {
        return undefined;
      }
      if (result.data.content.dataType !== 'moveObject') {
        throw new Error('Price feed type mismatch');
      }
      this.priceFeedObjectIdCache.set(
        normalizedFeedId,
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        result.data.content.fields.value,
      );
    }
    return this.priceFeedObjectIdCache.get(normalizedFeedId);
  }

  /**
   * Fetches the price table object id for the current state id if not cached
   * @returns price table object id
   */
  async getPriceTableInfo() {
    if (this.priceTableInfo === undefined) {
      const result = await this.provider.getDynamicFieldObject({
        parentId: this.pythStateId,
        name: {
          type: 'vector<u8>',
          value: 'price_info',
        },
      });
      if (!result.data || !result.data.type) {
        throw new Error('Price Table not found, contract may not be initialized');
      }
      let type = result.data.type.replace('0x2::table::Table<', '');
      type = type.replace('::price_identifier::PriceIdentifier, 0x2::object::ID>', '');
      this.priceTableInfo = { id: result.data.objectId, fieldType: type };
    }
    return this.priceTableInfo;
  }

  /**
   * Obtains the vaa bytes embedded in an accumulator message.
   * @param accumulatorMessage - the accumulator price update message
   * @returns vaa bytes as a uint8 array
   */
  extractVaaBytesFromAccumulatorMessage(accumulatorMessage: Buffer): Buffer {
    // the first 6 bytes in the accumulator message encode the header, major, and minor bytes
    // we ignore them, since we are only interested in the VAA bytes
    const trailingPayloadSize = accumulatorMessage.readUint8(6);
    const vaaSizeOffset =
      7 + // header bytes (header(4) + major(1) + minor(1) + trailing payload size(1))
      trailingPayloadSize + // trailing payload (variable number of bytes)
      1; // proof_type (1 byte)
    const vaaSize = accumulatorMessage.readUint16BE(vaaSizeOffset);
    const vaaOffset = vaaSizeOffset + 2;
    return accumulatorMessage.subarray(vaaOffset, vaaOffset + vaaSize);
  }
}
