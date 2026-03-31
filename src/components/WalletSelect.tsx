import React, { useMemo } from 'react'
import { Select } from 'antd'
import type { ManagedWallet } from '../types'
import { shortenAddress } from '../services/solana'

interface WalletSelectProps {
  wallets: ManagedWallet[]
  value?: string | string[]
  onChange?: (value: any) => void
  mode?: 'multiple' | undefined
  placeholder?: string
  style?: React.CSSProperties
  disabled?: boolean
}

function formatBalance(w: ManagedWallet): string {
  const parts: string[] = []
  if (w.solBalance != null) parts.push(`${w.solBalance.toFixed(4)} SOL`)
  if (w.tokenBalance != null) parts.push(`${w.tokenBalance.toFixed(4)} Token`)
  return parts.length > 0 ? ` [${parts.join(' | ')}]` : ''
}

const WalletSelect: React.FC<WalletSelectProps> = ({
  wallets,
  value,
  onChange,
  mode,
  placeholder = '选择钱包',
  style,
  disabled,
}) => {
  const grouped = useMemo(() => {
    const map: Record<string, ManagedWallet[]> = {}
    wallets.forEach((w) => {
      const key = w.groupName
      if (!map[key]) map[key] = []
      map[key].push(w)
    })
    return map
  }, [wallets])

  return (
    <Select
      showSearch
      mode={mode}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      style={style}
      disabled={disabled}
      optionFilterProp="label"
      maxTagCount="responsive"
      options={Object.entries(grouped).map(([groupName, gWallets]) => ({
        label: groupName,
        options: gWallets.map((w) => ({
          label: `#${w.derivationIndex}  ${shortenAddress(w.address, 6)}${formatBalance(w)}`,
          value: w.address,
        })),
      }))}
    />
  )
}

export default WalletSelect
