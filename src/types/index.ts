export type Network = 'mainnet-beta' | 'devnet' | 'testnet' | 'custom'

export type TokenType = 'SOL' | 'SPL'

export type TransferStatus = 'pending' | 'processing' | 'success' | 'failed'

export interface TransferConfig {
  network: Network
  rpcUrl: string
  tokenType: TokenType
  tokenMint: string
  tokenDecimals: number
  tokenSymbol: string
}

export interface WalletGroup {
  id: string
  name: string
  wallets: ManagedWallet[]
}

export interface ManagedWallet {
  address: string
  privateKey: string
  groupId: string
  groupName: string
  derivationIndex: number
  solBalance?: number
  tokenBalance?: number
}

export type AmountMode = 'fixed' | 'range' | 'all'

export interface RecipientRow {
  key: string
  address: string
  amount: number
  status: TransferStatus
  txHash?: string
  error?: string
}

export interface SenderRow {
  key: string
  walletAddress: string
  amount: number
  status: TransferStatus
  txHash?: string
  error?: string
}

export interface PairRow {
  key: string
  senderAddress: string
  recipientAddress: string
  amount: number
  status: TransferStatus
  txHash?: string
  error?: string
}
