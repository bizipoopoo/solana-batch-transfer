import { Keypair } from '@solana/web3.js'
import { mnemonicToSeedSync, validateMnemonic } from 'bip39'
import { derivePath } from 'ed25519-hd-key'
import bs58 from 'bs58'

export interface DerivedWallet {
  index: number
  address: string
  privateKey: string
  keypair: Keypair
}

export function isValidMnemonic(mnemonic: string): boolean {
  return validateMnemonic(mnemonic.trim())
}

/**
 * Derive a single wallet from mnemonic at the given index.
 * Uses Phantom-compatible derivation path: m/44'/501'/{index}'/0'
 */
export function deriveWallet(
  mnemonic: string,
  index: number,
  pathPrefix = "m/44'/501'",
): DerivedWallet {
  const seed = mnemonicToSeedSync(mnemonic.trim())
  const path = `${pathPrefix}/${index}'/0'`
  const { key } = derivePath(path, Buffer.from(seed).toString('hex'))
  const keypair = Keypair.fromSeed(key)
  return {
    index,
    address: keypair.publicKey.toBase58(),
    privateKey: bs58.encode(keypair.secretKey),
    keypair,
  }
}

export function deriveWallets(
  mnemonic: string,
  startIndex: number,
  count: number,
  pathPrefix = "m/44'/501'",
): DerivedWallet[] {
  return Array.from({ length: count }, (_, i) =>
    deriveWallet(mnemonic, startIndex + i, pathPrefix),
  )
}
