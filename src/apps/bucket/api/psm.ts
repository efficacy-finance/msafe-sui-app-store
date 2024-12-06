import { SuiNetworks } from "@/types";
import { Transaction } from "@mysten/sui/transactions";
import { WalletAccount } from '@mysten/wallet-standard';
import { getBucketClient } from "./config";
import { buildPsmTx } from "bucket-protocol-sdk";

export interface PsmIntentionData {
    coinType: string;
    amount: string;
}

export const getPsmTx = async (
    txbParams: PsmIntentionData,
    account: WalletAccount,
    network: SuiNetworks,
    isOut: boolean
): Promise<Transaction> => {
    const { coinType, amount } = txbParams;

    const tx = new Transaction();
    const client = getBucketClient(network, account);
    await buildPsmTx(client, tx, coinType, amount, isOut, account.address);

    return tx;
};
