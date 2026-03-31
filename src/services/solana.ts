import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL,
  clusterApiUrl,
} from '@solana/web3.js'
import {
  getOrCreateAssociatedTokenAccount,
  getAssociatedTokenAddress,
  getAccount,
  createTransferInstruction,
  getMint,
} from '@solana/spl-token'
import bs58 from 'bs58'
import type { Network } from '../types'

const MAINNET_RPC = 'https://dawn-small-theorem.solana-mainnet.quiknode.pro/0d31dd8d25f4e580c5c486960f69f361efb0b961/'

export function getRpcUrl(network: Network, customUrl?: string): string {
  if (network === 'custom' && customUrl) return customUrl
  if (network === 'mainnet-beta') return MAINNET_RPC
  return clusterApiUrl(network as 'devnet' | 'testnet')
}

export function getConnection(network: Network, customUrl?: string): Connection {
  return new Connection(getRpcUrl(network, customUrl), 'confirmed')
}

export function keypairFromPrivateKey(key: string): Keypair {
  const trimmed = key.trim()
  try {
    const decoded = bs58.decode(trimmed)
    return Keypair.fromSecretKey(decoded)
  } catch {
    const arr = JSON.parse(trimmed)
    return Keypair.fromSecretKey(new Uint8Array(arr))
  }
}

export function shortenAddress(address: string, chars = 6): string {
  if (!address) return ''
  if (address.length <= chars * 2 + 3) return address
  return `${address.slice(0, chars)}...${address.slice(-chars)}`
}

export async function getSOLBalance(
  connection: Connection,
  publicKey: PublicKey,
): Promise<number> {
  const balance = await connection.getBalance(publicKey)
  return balance / LAMPORTS_PER_SOL
}

export async function getTokenDecimals(
  connection: Connection,
  mint: PublicKey,
): Promise<number> {
  const mintInfo = await getMint(connection, mint)
  return mintInfo.decimals
}

export async function getTokenBalance(
  connection: Connection,
  owner: PublicKey,
  mint: PublicKey,
): Promise<number> {
  try {
    const ata = await getAssociatedTokenAddress(mint, owner)
    const account = await getAccount(connection, ata)
    const mintInfo = await getMint(connection, mint)
    return Number(account.amount) / Math.pow(10, mintInfo.decimals)
  } catch {
    return 0
  }
}

export async function transferSOL(
  connection: Connection,
  sender: Keypair,
  recipient: PublicKey,
  amount: number,
): Promise<string> {
  const transaction = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: sender.publicKey,
      toPubkey: recipient,
      lamports: Math.round(amount * LAMPORTS_PER_SOL),
    }),
  )
  return sendAndConfirmTransaction(connection, transaction, [sender])
}

export async function transferSPLToken(
  connection: Connection,
  sender: Keypair,
  recipient: PublicKey,
  mint: PublicKey,
  amount: number,
  decimals: number,
): Promise<string> {
  const senderATA = await getOrCreateAssociatedTokenAccount(
    connection,
    sender,
    mint,
    sender.publicKey,
  )

  const recipientATA = await getOrCreateAssociatedTokenAccount(
    connection,
    sender, // payer
    mint,
    recipient,
  )

  const transferAmount = BigInt(Math.round(amount * Math.pow(10, decimals)))

  const transaction = new Transaction().add(
    createTransferInstruction(
      senderATA.address,
      recipientATA.address,
      sender.publicKey,
      transferAmount,
    ),
  )

  return sendAndConfirmTransaction(connection, transaction, [sender])
}

export interface TokenMintInfo {
  address: string
  decimals: number
  supply: string
}

export async function validateTokenMint(
  connection: Connection,
  mintAddress: string,
): Promise<TokenMintInfo> {
  let pubkey: PublicKey
  try {
    pubkey = new PublicKey(mintAddress)
  } catch {
    throw new Error('无效的 Mint 地址格式')
  }

  // First verify the account exists via raw getAccountInfo
  const accountInfo = await connection.getAccountInfo(pubkey)
  if (!accountInfo) {
    throw new Error('链上未找到该地址对应的账户，请检查地址和网络')
  }

  const mintInfo = await getMint(connection, pubkey)
  return {
    address: mintAddress,
    decimals: mintInfo.decimals,
    supply: mintInfo.supply.toString(),
  }
}

export async function batchGetSOLBalances(
  connection: Connection,
  addresses: string[],
): Promise<Map<string, number>> {
  const result = new Map<string, number>()
  const pubkeys = addresses.map((a) => new PublicKey(a))

  // Use getMultipleAccountsInfo for efficiency (batch RPC)
  const batchSize = 100
  for (let i = 0; i < pubkeys.length; i += batchSize) {
    const batch = pubkeys.slice(i, i + batchSize)
    const accounts = await connection.getMultipleAccountsInfo(batch)
    accounts.forEach((acc, idx) => {
      const addr = addresses[i + idx]
      result.set(addr, acc ? acc.lamports / LAMPORTS_PER_SOL : 0)
    })
  }
  return result
}

export async function batchGetTokenBalances(
  connection: Connection,
  addresses: string[],
  mint: PublicKey,
  decimals: number,
): Promise<Map<string, number>> {
  const result = new Map<string, number>()
  for (const addr of addresses) {
    try {
      const owner = new PublicKey(addr)
      const ata = await getAssociatedTokenAddress(mint, owner)
      const account = await getAccount(connection, ata)
      result.set(addr, Number(account.amount) / Math.pow(10, decimals))
    } catch {
      result.set(addr, 0)
    }
  }
  return result
}

/**
 * Estimate the transaction fee for a simple SOL transfer.
 * Uses getFeeForMessage when available, falls back to 5000 lamports.
 */
export async function estimateSOLTransferFee(
  connection: Connection,
  sender: Keypair,
  recipient: PublicKey,
): Promise<number> {
  try {
    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: sender.publicKey,
        toPubkey: recipient,
        lamports: 0,
      }),
    )
    tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash
    tx.feePayer = sender.publicKey
    const fee = await connection.getFeeForMessage(tx.compileMessage())
    if (fee.value != null) return fee.value
  } catch {
    // fallback
  }
  return 5000
}

export async function transferAllSOL(
  connection: Connection,
  sender: Keypair,
  recipient: PublicKey,
): Promise<string> {
  const balance = await connection.getBalance(sender.publicKey)
  const fee = await estimateSOLTransferFee(connection, sender, recipient)
  const lamportsToSend = balance - fee
  if (lamportsToSend <= 0) {
    throw new Error(`余额不足以支付手续费 (余额: ${balance / LAMPORTS_PER_SOL} SOL, 手续费: ${fee / LAMPORTS_PER_SOL} SOL)`)
  }
  const transaction = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: sender.publicKey,
      toPubkey: recipient,
      lamports: lamportsToSend,
    }),
  )
  return sendAndConfirmTransaction(connection, transaction, [sender])
}

export async function transferAllSPLToken(
  connection: Connection,
  sender: Keypair,
  recipient: PublicKey,
  mint: PublicKey,
  decimals: number,
): Promise<string> {
  const senderATA = await getOrCreateAssociatedTokenAccount(connection, sender, mint, sender.publicKey)
  const recipientATA = await getOrCreateAssociatedTokenAccount(connection, sender, mint, recipient)
  const amount = senderATA.amount
  if (amount <= 0n) {
    throw new Error('代币余额为 0，无法转账')
  }
  const transaction = new Transaction().add(
    createTransferInstruction(senderATA.address, recipientATA.address, sender.publicKey, amount),
  )
  return sendAndConfirmTransaction(connection, transaction, [sender])
}

export function randomAmount(min: number, max: number): number {
  return Math.round((min + Math.random() * (max - min)) * 1e6) / 1e6
}

export function getExplorerUrl(txHash: string, network: Network): string {
  const base = 'https://explorer.solana.com/tx/'
  if (network === 'mainnet-beta') return `${base}${txHash}`
  const cluster = network === 'custom' ? 'custom' : network
  return `${base}${txHash}?cluster=${cluster}`
}

/**
 * Worker-pool style concurrent executor.
 * Runs up to `concurrency` tasks in parallel from a queue of `count` items.
 */
export async function runWithConcurrency(
  count: number,
  concurrency: number,
  isCancelled: () => boolean,
  task: (index: number) => Promise<void>,
): Promise<void> {
  let nextIdx = 0
  const workers = Array.from(
    { length: Math.min(concurrency, count) },
    async () => {
      while (!isCancelled()) {
        const idx = nextIdx++
        if (idx >= count) return
        await task(idx)
      }
    },
  )
  await Promise.all(workers)
}
