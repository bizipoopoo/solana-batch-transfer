import React, { useState, useCallback } from 'react'
import {
  ConfigProvider,
  Layout,
  Tabs,
  Select,
  Input,
  Typography,
  Space,
  Button,
  Tag,
  message,
} from 'antd'
import {
  SwapOutlined,
  WalletOutlined,
  SendOutlined,
  SearchOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  LoadingOutlined,
  RetweetOutlined,
  HeartOutlined,
} from '@ant-design/icons'
import zhCN from 'antd/locale/zh_CN'
import WalletManager from './components/WalletManager'
import OneToMany from './components/OneToMany'
import ManyToMany from './components/ManyToMany'
import ManyToOne from './components/ManyToOne'
import FundRecovery from './components/FundRecovery'
import Donation from './components/Donation'
import {
  getConnection,
  validateTokenMint,
  batchGetSOLBalances,
  batchGetTokenBalances,
} from './services/solana'
import { PublicKey } from '@solana/web3.js'
import type { Network, TokenType, TransferConfig, WalletGroup, ManagedWallet } from './types'
import './App.css'

const { Header, Content } = Layout
const { Title } = Typography

const App: React.FC = () => {
  const [network, setNetwork] = useState<Network>('mainnet-beta')
  const [customRpc, setCustomRpc] = useState('')
  const [tokenType, setTokenType] = useState<TokenType>('SOL')
  const [tokenMint, setTokenMint] = useState('')
  const [tokenDecimals, setTokenDecimals] = useState(9)
  const [tokenSymbol, setTokenSymbol] = useState('SOL')
  const [tokenValidating, setTokenValidating] = useState(false)
  const [tokenValid, setTokenValid] = useState<boolean | null>(null)

  const [walletGroups, setWalletGroups] = useState<WalletGroup[]>([])

  const allWallets: ManagedWallet[] = walletGroups.flatMap((g) => g.wallets)

  const config: TransferConfig = {
    network,
    rpcUrl: customRpc,
    tokenType,
    tokenMint,
    tokenDecimals,
    tokenSymbol,
  }

  const handleValidateToken = async () => {
    const addr = tokenMint.trim()
    if (!addr) return message.warning('请输入代币 Mint 地址')

    setTokenValidating(true)
    setTokenValid(null)
    try {
      const conn = getConnection(network, customRpc)
      const info = await validateTokenMint(conn, addr)
      setTokenDecimals(info.decimals)
      setTokenSymbol(`SPL(${info.decimals}位精度)`)
      setTokenValid(true)
      message.success(`代币验证成功 — 精度: ${info.decimals} 位`)
    } catch (err: any) {
      setTokenValid(false)
      message.error(err.message || '查询失败，请检查网络连接')
    } finally {
      setTokenValidating(false)
    }
  }

  const handleRefreshBalances = useCallback(async () => {
    if (allWallets.length === 0) return
    const conn = getConnection(network, customRpc)
    const addresses = allWallets.map((w) => w.address)

    try {
      const solMap = await batchGetSOLBalances(conn, addresses)

      let tokenMap: Map<string, number> | undefined
      if (tokenType === 'SPL' && tokenMint && tokenValid) {
        tokenMap = await batchGetTokenBalances(
          conn,
          addresses,
          new PublicKey(tokenMint),
          tokenDecimals,
        )
      }

      setWalletGroups((prev) =>
        prev.map((group) => ({
          ...group,
          wallets: group.wallets.map((w) => ({
            ...w,
            solBalance: solMap.get(w.address) ?? w.solBalance,
            tokenBalance: tokenMap?.get(w.address) ?? w.tokenBalance,
          })),
        })),
      )

      message.success('余额刷新完成')
    } catch (err: any) {
      message.error(`余额查询失败: ${err.message}`)
    }
  }, [allWallets, network, customRpc, tokenType, tokenMint, tokenValid, tokenDecimals])

  return (
    <ConfigProvider
      locale={zhCN}
      theme={{ token: { colorPrimary: '#6366f1', borderRadius: 8 } }}
    >
      <Layout style={{ minHeight: '100vh' }}>
        <Header className="app-header">
          <Title level={4} style={{ color: '#fff', margin: 0, whiteSpace: 'nowrap' }}>
            Solana 批量转账
          </Title>
          <Space size="middle" wrap>
            <Select
              value={network}
              onChange={setNetwork}
              style={{ width: 150 }}
              popupMatchSelectWidth={false}
              options={[
                { label: 'Devnet', value: 'devnet' },
                { label: 'Testnet', value: 'testnet' },
                { label: 'Mainnet', value: 'mainnet-beta' },
                { label: '自定义 RPC', value: 'custom' },
              ]}
            />
            {network === 'custom' && (
              <Input
                placeholder="RPC URL"
                value={customRpc}
                onChange={(e) => setCustomRpc(e.target.value)}
                style={{ width: 300 }}
              />
            )}
            <Select
              value={tokenType}
              onChange={(v) => {
                setTokenType(v)
                if (v === 'SOL') {
                  setTokenMint('')
                  setTokenDecimals(9)
                  setTokenSymbol('SOL')
                  setTokenValid(null)
                }
              }}
              style={{ width: 130 }}
              options={[
                { label: 'SOL', value: 'SOL' },
                { label: 'SPL 代币', value: 'SPL' },
              ]}
            />
            {tokenType === 'SPL' && (
              <>
                <Space.Compact>
                  <Input
                    placeholder="代币 Mint 地址"
                    value={tokenMint}
                    onChange={(e) => {
                      setTokenMint(e.target.value)
                      setTokenValid(null)
                    }}
                    style={{ width: 360 }}
                    allowClear
                    onPressEnter={handleValidateToken}
                  />
                  <Button
                    type="primary"
                    icon={tokenValidating ? <LoadingOutlined /> : <SearchOutlined />}
                    onClick={handleValidateToken}
                    disabled={tokenValidating}
                  >
                    链上查询
                  </Button>
                </Space.Compact>
                {tokenValid === true && (
                  <Tag color="success" icon={<CheckCircleOutlined />}>
                    精度 {tokenDecimals} 位
                  </Tag>
                )}
                {tokenValid === false && (
                  <Tag color="error" icon={<CloseCircleOutlined />}>
                    查询失败
                  </Tag>
                )}
              </>
            )}
          </Space>
        </Header>
        <Content className="app-content">
          <div className="wallet-section">
            <WalletManager
              groups={walletGroups}
              onAddGroup={(g) => setWalletGroups((prev) => [...prev, g])}
              onRemoveGroup={(id) =>
                setWalletGroups((prev) => prev.filter((g) => g.id !== id))
              }
              onRefreshBalances={handleRefreshBalances}
              tokenType={tokenType}
              tokenSymbol={tokenSymbol}
            />
          </div>
          <Tabs
            type="card"
            size="large"
            items={[
              {
                key: 'one-to-many',
                label: (
                  <span>
                    <SendOutlined /> 一对多
                  </span>
                ),
                children: <OneToMany config={config} wallets={allWallets} />,
              },
              {
                key: 'many-to-many',
                label: (
                  <span>
                    <SwapOutlined /> 多对多
                  </span>
                ),
                children: <ManyToMany config={config} wallets={allWallets} />,
              },
              {
                key: 'many-to-one',
                label: (
                  <span>
                    <WalletOutlined /> 多对一
                  </span>
                ),
                children: <ManyToOne config={config} wallets={allWallets} />,
              },
              {
                key: 'fund-recovery',
                label: (
                  <span>
                    <RetweetOutlined /> 资金回收
                  </span>
                ),
                children: <FundRecovery config={config} wallets={allWallets} />,
              },
              {
                key: 'donation',
                label: (
                  <span>
                    <HeartOutlined /> 捐赠
                  </span>
                ),
                children: <Donation />,
              },
            ]}
          />
        </Content>
      </Layout>
    </ConfigProvider>
  )
}

export default App
