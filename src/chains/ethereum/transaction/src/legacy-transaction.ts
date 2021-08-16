import {
  Data,
  Quantity,
  keccak,
  BUFFER_EMPTY,
  BUFFER_32_ZERO,
  RPCQUANTITY_EMPTY
} from "@ganache/utils";
import { Address } from "@ganache/ethereum-address";
import type Common from "@ethereumjs/common";
import { ecsign } from "ethereumjs-util";
import { encodeRange, digest } from "@ganache/rlp";
import { BN } from "ethereumjs-util";
import { RuntimeTransaction } from "./runtime-transaction";
import { TypedRpcTransaction } from "./rpc-transaction";
import {
  LegacyDatabasePayload,
  LegacyDatabaseTx,
  TypedDatabaseTransaction
} from "./raw";
import { computeInstrinsicsLegacyTx } from "./signing";

export class LegacyTransaction extends RuntimeTransaction {
  public gasPrice: Quantity;
  public type: Quantity = Quantity.from("0x0");

  public constructor(
    data: LegacyDatabasePayload | TypedRpcTransaction,
    common: Common
  ) {
    super(data, common);
    if (Array.isArray(data)) {
      this.nonce = Quantity.from(data[0], true);
      this.gasPrice = Quantity.from(data[1]);
      this.gas = Quantity.from(data[2]);
      this.to = data[3].length == 0 ? RPCQUANTITY_EMPTY : Address.from(data[3]);
      this.value = Quantity.from(data[4]);
      this.data = Data.from(data[5]);
      this.v = Quantity.from(data[6]);
      this.r = Quantity.from(data[7]);
      this.s = Quantity.from(data[8]);
      this.raw = [this.type.toBuffer(), ...data];

      const {
        from,
        serialized,
        hash,
        encodedData,
        encodedSignature
      } = this.computeIntrinsics(this.v, this.raw, this.common.chainId());

      this.from = from;
      this.serialized = serialized;
      this.hash = hash;
      this.encodedData = encodedData;
      this.encodedSignature = encodedSignature;
    } else {
      this.gasPrice = Quantity.from(data.gasPrice);
    }
  }

  public toJSON = () => {
    return {
      type: this.type,
      hash: this.hash,
      nonce: this.nonce,
      blockHash: null,
      blockNumber: null,
      transactionIndex: null,
      from: this.from,
      to: this.to.isNull() ? null : this.to,
      value: this.value,
      gas: this.gas,
      gasPrice: this.gasPrice,
      input: this.data,
      v: this.v,
      r: this.r,
      s: this.s
    };
  };

  public static fromTxData(
    data: LegacyDatabasePayload | TypedRpcTransaction,
    common: Common
  ) {
    return new LegacyTransaction(data, common);
  }

  public toVmTransaction() {
    const sender = this.from.toBuffer();
    const to = this.to.toBuffer();
    const data = this.data.toBuffer();
    return {
      hash: () => BUFFER_32_ZERO,
      nonce: new BN(this.nonce.toBuffer()),
      gasPrice: new BN(this.gasPrice.toBuffer()),
      gasLimit: new BN(this.gas.toBuffer()),
      to:
        to.length === 0
          ? null
          : { buf: to, equals: (a: { buf: Buffer }) => to.equals(a.buf) },
      value: new BN(this.value.toBuffer()),
      data,
      getSenderAddress: () => ({
        buf: sender,
        equals: (a: { buf: Buffer }) => sender.equals(a.buf)
      }),
      /**
       * the minimum amount of gas the tx must have (DataFee + TxFee + Creation Fee)
       */
      getBaseFee: () => {
        const fee = this.calculateIntrinsicGas();
        return new BN(Quantity.from(fee).toBuffer());
      },
      getUpfrontCost: () => {
        const { gas, gasPrice, value } = this;
        try {
          const c = gas.toBigInt() * gasPrice.toBigInt() + value.toBigInt();
          return new BN(Quantity.from(c).toBuffer());
        } catch (e) {
          throw e;
        }
      },
      supports: (capability: any) => {
        return false;
      }
    };
  }
  /**
   * sign a transaction with a given private key, then compute and set the `hash`.
   *
   * @param privateKey - Must be 32 bytes in length
   */
  public signAndHash(privateKey: Buffer) {
    if (this.v != null) {
      throw new Error(
        "Internal Error: RuntimeTransaction `sign` called but transaction has already been signed"
      );
    }

    const chainId = this.common.chainId();
    const raw: LegacyDatabaseTx = this.toEthRawTransaction(
      Quantity.from(chainId).toBuffer(),
      BUFFER_EMPTY,
      BUFFER_EMPTY
    );
    const data = encodeRange(raw, 1, 6);
    const dataLength = data.length;

    const ending = encodeRange(raw, 7, 3);
    const msgHash = keccak(
      digest([data.output, ending.output], dataLength + ending.length)
    );
    const sig = ecsign(msgHash, privateKey, chainId);
    this.v = Quantity.from(sig.v);
    this.r = Quantity.from(sig.r);
    this.s = Quantity.from(sig.s);

    raw[7] = this.v.toBuffer();
    raw[8] = this.r.toBuffer();
    raw[9] = this.s.toBuffer();

    this.raw = raw;
    const encodedSignature = encodeRange(raw, 7, 3);
    this.serialized = digest(
      [data.output, encodedSignature.output],
      dataLength + encodedSignature.length
    );
    this.hash = Data.from(keccak(this.serialized));
    this.encodedData = data;
    this.encodedSignature = encodedSignature;
  }

  public toEthRawTransaction(
    v: Buffer,
    r: Buffer,
    s: Buffer
  ): LegacyDatabaseTx {
    return [
      this.type.toBuffer(),
      this.nonce.toBuffer(),
      this.gasPrice.toBuffer(),
      this.gas.toBuffer(),
      this.to.toBuffer(),
      this.value.toBuffer(),
      this.data.toBuffer(),
      v,
      r,
      s
    ];
  }

  public computeIntrinsics(
    v: Quantity,
    raw: TypedDatabaseTransaction,
    chainId: number
  ) {
    return computeInstrinsicsLegacyTx(v, <LegacyDatabaseTx>raw, chainId);
  }
}