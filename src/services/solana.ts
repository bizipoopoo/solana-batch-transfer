import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  VersionedTransaction,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL,
  clusterApiUrl,
} from '@solana/web3.js'
import {
  getOrCreateAssociatedTokenAccount,
  getAssociatedTokenAddress,
  getAccount,
  createTransferInstruction,
  createCloseAccountInstruction,
  createBurnInstruction,
  getMint,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
} from '@solana/spl-token'
import bs58 from 'bs58'
import type { Network } from '../types'

const MAINNET_RPC = 'https://blissful-quaint-panorama.solana-mainnet.quiknode.pro/04d12d7889e8d672c64b70caff7fc9863b9eeff3/'
const WSOL_MINT = 'So11111111111111111111111111111111111111112'
const JUPITER_QUOTE_URL = 'https://lite-api.jup.ag/swap/v1/quote'
const JUPITER_SWAP_URL = 'https://lite-api.jup.ag/swap/v1/swap'
const DEFAULT_SLIPPAGE_BPS = 100

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
  const senderATAAddress = await getAssociatedTokenAddress(mint, sender.publicKey)
  const senderATA = await getAccount(connection, senderATAAddress)
  const recipientATA = await getOrCreateAssociatedTokenAccount(connection, sender, mint, recipient)
  const amount = senderATA.amount
  if (amount <= 0n) {
    throw new Error('代币余额为 0，无法转账')
  }
  const transaction = new Transaction().add(
    createTransferInstruction(senderATA.address, recipientATA.address, sender.publicKey, amount),
    // When sweeping all SPL tokens, also close the emptied sender ATA
    // so its rent is reclaimed to the next wallet in the chain.
    createCloseAccountInstruction(senderATA.address, recipient, sender.publicKey),
  )
  return sendAndConfirmTransaction(connection, transaction, [sender])
}

interface OwnedTokenAccountInfo {
  address: PublicKey
  mint: PublicKey
  amount: bigint
  programId: PublicKey
}

export interface SweepWalletResult {
  txHashes: string[]
  closedTokenAccounts: number
  soldTokenAccounts: number
  burnedTokenAccounts: number
  failedTokenAccounts: number
  transferredSOL: number
  failureMessages: string[]
}

class UnsellableTokenError extends Error {}

async function fetchJsonOrThrow<T>(input: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(input, init)
  } catch (error: any) {
    throw new Error(`请求失败: ${error?.message || '网络错误'}`)
  }

  const text = await response.text()
  const data = text ? JSON.parse(text) : {}
  if (!response.ok) {
    const message = data?.error || data?.message || text || `HTTP ${response.status}`
    if (response.status >= 400 && response.status < 500) {
      throw new UnsellableTokenError(message)
    }
    throw new Error(message)
  }
  return data as T
}

async function getOwnedTokenAccounts(
  connection: Connection,
  owner: PublicKey,
): Promise<OwnedTokenAccountInfo[]> {
  const tokenPrograms = [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID]
  const results = await Promise.all(
    tokenPrograms.map((programId) =>
      connection.getParsedTokenAccountsByOwner(owner, { programId }, 'confirmed'),
    ),
  )

  return results.flatMap((result, idx) =>
    result.value.flatMap(({ pubkey, account }) => {
      const parsed = account.data.parsed
      if (!parsed || parsed.type !== 'account') return []
      return [{
        address: pubkey,
        mint: new PublicKey(parsed.info.mint),
        amount: BigInt(parsed.info.tokenAmount.amount),
        programId: tokenPrograms[idx],
      }]
    }),
  )
}

async function sellTokenToSOLViaJupiter(
  connection: Connection,
  sender: Keypair,
  mint: PublicKey,
  amount: bigint,
  slippageBps = DEFAULT_SLIPPAGE_BPS,
): Promise<string> {
  const params = new URLSearchParams({
    inputMint: mint.toBase58(),
    outputMint: WSOL_MINT,
    amount: amount.toString(),
    slippageBps: slippageBps.toString(),
  })

  const quote = await fetchJsonOrThrow<any>(`${JUPITER_QUOTE_URL}?${params.toString()}`)
  if (!quote?.routePlan?.length) {
    throw new UnsellableTokenError('Jupiter 无可用卖出路由')
  }

  const swapResponse = await fetchJsonOrThrow<any>(JUPITER_SWAP_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      quoteResponse: quote,
      userPublicKey: sender.publicKey.toBase58(),
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
    }),
  })

  if (!swapResponse?.swapTransaction) {
    throw new Error('Jupiter 未返回可执行交易')
  }

  const serialized = Uint8Array.from(Buffer.from(swapResponse.swapTransaction, 'base64'))
  const transaction = VersionedTransaction.deserialize(serialized)
  transaction.sign([sender])

  const signature = await connection.sendRawTransaction(transaction.serialize(), {
    skipPreflight: false,
    maxRetries: 3,
  })
  await connection.confirmTransaction(signature, 'confirmed')
  return signature
}

async function closeTokenAccount(
  connection: Connection,
  sender: Keypair,
  tokenAccount: PublicKey,
  destination: PublicKey,
  programId: PublicKey,
): Promise<string> {
  const transaction = new Transaction().add(
    createCloseAccountInstruction(tokenAccount, destination, sender.publicKey, [], programId),
  )
  return sendAndConfirmTransaction(connection, transaction, [sender])
}

async function burnAndCloseTokenAccount(
  connection: Connection,
  sender: Keypair,
  tokenAccount: PublicKey,
  mint: PublicKey,
  amount: bigint,
  destination: PublicKey,
  programId: PublicKey,
): Promise<string> {
  const transaction = new Transaction().add(
    createBurnInstruction(tokenAccount, mint, sender.publicKey, amount, [], programId),
    createCloseAccountInstruction(tokenAccount, destination, sender.publicKey, [], programId),
  )
  return sendAndConfirmTransaction(connection, transaction, [sender])
}

/**
 * Sweep a wallet to the next wallet in the chain:
 * 1. Scan all SPL token accounts owned by sender
 * 2. Empty account => close directly and reclaim rent
 * 3. WSOL account => close directly to unwrap
 * 4. Non-empty token account => try sell to SOL via Jupiter
 * 5. If unsellable => burn then close
 * 6. If any token account still fails, abort before final SOL transfer
 * 7. Transfer remaining SOL to recipient (minus fee)
 */
export async function sweepWalletToNext(
  connection: Connection,
  sender: Keypair,
  recipient: PublicKey,
): Promise<SweepWalletResult> {
  const txHashes: string[] = []
  let closedTokenAccounts = 0
  let soldTokenAccounts = 0
  let burnedTokenAccounts = 0
  let failedTokenAccounts = 0
  let transferredSOL = 0
  const failureMessages: string[] = []

  const tokenAccounts = await getOwnedTokenAccounts(connection, sender.publicKey)

  for (const tokenAccount of tokenAccounts) {
    const mintStr = tokenAccount.mint.toBase58()

    try {
      if (tokenAccount.amount === 0n || mintStr === WSOL_MINT) {
        const closeSig = await closeTokenAccount(
          connection,
          sender,
          tokenAccount.address,
          sender.publicKey,
          tokenAccount.programId,
        )
        txHashes.push(closeSig)
        closedTokenAccounts += 1
        continue
      }

      try {
        const sellSig = await sellTokenToSOLViaJupiter(
          connection,
          sender,
          tokenAccount.mint,
          tokenAccount.amount,
        )
        txHashes.push(sellSig)
        soldTokenAccounts += 1

        const closeSig = await closeTokenAccount(
          connection,
          sender,
          tokenAccount.address,
          sender.publicKey,
          tokenAccount.programId,
        )
        txHashes.push(closeSig)
        closedTokenAccounts += 1
      } catch (error: any) {
        if (!(error instanceof UnsellableTokenError)) {
          throw error
        }

        const burnCloseSig = await burnAndCloseTokenAccount(
          connection,
          sender,
          tokenAccount.address,
          tokenAccount.mint,
          tokenAccount.amount,
          sender.publicKey,
          tokenAccount.programId,
        )
        txHashes.push(burnCloseSig)
        burnedTokenAccounts += 1
        closedTokenAccounts += 1
      }
    } catch (error: any) {
      failedTokenAccounts += 1
      failureMessages.push(`${shortenAddress(mintStr, 8)}: ${error?.message || '处理失败'}`)
      continue
    }
  }

  if (failedTokenAccounts > 0) {
    throw new Error(`有 ${failedTokenAccounts} 个代币账户处理失败：${failureMessages.join('；')}`)
  }

  const balance = await connection.getBalance(sender.publicKey)
  const fee = await estimateSOLTransferFee(connection, sender, recipient)
  const lamportsToSend = balance - fee

  if (lamportsToSend > 0) {
    const txHash = await transferAllSOL(connection, sender, recipient)
    txHashes.push(txHash)
    transferredSOL = lamportsToSend / LAMPORTS_PER_SOL
  }

  return {
    txHashes,
    closedTokenAccounts,
    soldTokenAccounts,
    burnedTokenAccounts,
    failedTokenAccounts,
    transferredSOL,
    failureMessages,
  }
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
