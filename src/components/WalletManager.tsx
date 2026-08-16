import React, { useState } from 'react'
import {
  Button,
  Input,
  InputNumber,
  Space,
  Collapse,
  Table,
  Typography,
  message,
  Modal,
  Form,
  Tag,
  Popconfirm,
  Alert,
  Tooltip,
} from 'antd'
import {
  PlusOutlined,
  DeleteOutlined,
  KeyOutlined,
  ReloadOutlined,
  ImportOutlined,
} from '@ant-design/icons'
import type { WalletGroup, TokenType } from '../types'
import { isValidMnemonic, deriveWallets } from '../services/mnemonic'
import { shortenAddress, walletFromPrivateKey } from '../services/solana'

interface Props {
  groups: WalletGroup[]
  onAddGroup: (group: WalletGroup) => void
  onRemoveGroup: (id: string) => void
  onRefreshBalances: () => Promise<void>
  tokenType: TokenType
  tokenSymbol: string
}

const WalletManager: React.FC<Props> = ({
  groups,
  onAddGroup,
  onRemoveGroup,
  onRefreshBalances,
  tokenType,
  tokenSymbol,
}) => {
  const [modalOpen, setModalOpen] = useState(false)
  const [mnemonic, setMnemonic] = useState('')
  const [groupName, setGroupName] = useState('')
  const [privateKeyModalOpen, setPrivateKeyModalOpen] = useState(false)
  const [privateKeys, setPrivateKeys] = useState('')
  const [privateKeyGroupName, setPrivateKeyGroupName] = useState('')
  const [startIndex, setStartIndex] = useState(0)
  const [count, setCount] = useState(10)
  const [refreshing, setRefreshing] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [importingPrivateKeys, setImportingPrivateKeys] = useState(false)

  const allWallets = groups.flatMap((g) => g.wallets)
  const allWalletCount = allWallets.length
  const totalSOL = allWallets.reduce((s, w) => s + (w.solBalance ?? 0), 0)
  const totalToken = allWallets.reduce((s, w) => s + (w.tokenBalance ?? 0), 0)
  const hasBalances = allWallets.some((w) => w.solBalance != null)

  const handleImport = async () => {
    const trimmed = mnemonic.trim()
    if (!trimmed) return message.warning('请输入助记词')
    if (!isValidMnemonic(trimmed)) return message.error('助记词无效，请检查拼写和单词数量')

    setGenerating(true)
    try {
      // 放到下一个 tick，让 UI 先渲染 loading 状态
      await new Promise((r) => setTimeout(r, 50))
      const derived = deriveWallets(trimmed, startIndex, count)
      const id = `${Date.now()}-${Math.random()}`
      const name = groupName.trim() || `助记词 ${groups.length + 1}`
      const group: WalletGroup = {
        id,
        name,
        wallets: derived.map((w) => ({
          address: w.address,
          privateKey: w.privateKey,
          groupId: id,
          groupName: name,
          derivationIndex: w.index,
        })),
      }
      onAddGroup(group)
      setMnemonic('')
      setGroupName('')
      setModalOpen(false)
      message.success(`已生成 ${derived.length} 个钱包`)
    } catch (err: any) {
      message.error(`派生失败: ${err.message}`)
    } finally {
      setGenerating(false)
    }
  }

  const handleRefresh = async () => {
    setRefreshing(true)
    try {
      await onRefreshBalances()
    } finally {
      setRefreshing(false)
    }
  }

  const handlePrivateKeyImport = async () => {
    const entries = privateKeys
      .split(/\r?\n/)
      .map((value, index) => ({ value: value.trim(), line: index + 1 }))
      .filter((entry) => entry.value)

    if (entries.length === 0) return message.warning('请输入私钥')

    setImportingPrivateKeys(true)
    try {
      await new Promise((resolve) => setTimeout(resolve, 50))

      const parsed: Array<{ address: string; privateKey: string }> = []
      const invalidLines: number[] = []

      for (const entry of entries) {
        try {
          parsed.push(walletFromPrivateKey(entry.value))
        } catch {
          invalidLines.push(entry.line)
        }
      }

      if (invalidLines.length > 0) {
        const visibleLines = invalidLines.slice(0, 10).join('、')
        const suffix = invalidLines.length > 10 ? ` 等 ${invalidLines.length} 行` : ''
        return message.error(`第 ${visibleLines}${suffix} 私钥格式无效，请检查后重试`)
      }

      const knownAddresses = new Set(allWallets.map((wallet) => wallet.address))
      const uniqueWallets = parsed.filter((wallet) => {
        if (knownAddresses.has(wallet.address)) return false
        knownAddresses.add(wallet.address)
        return true
      })
      const duplicateCount = parsed.length - uniqueWallets.length

      if (uniqueWallets.length === 0) {
        return message.warning('没有可导入的新钱包，输入的地址均已存在或重复')
      }

      const id = `${Date.now()}-${Math.random()}`
      const name = privateKeyGroupName.trim() || `私钥组 ${groups.length + 1}`
      const group: WalletGroup = {
        id,
        name,
        wallets: uniqueWallets.map((wallet) => ({
          ...wallet,
          groupId: id,
          groupName: name,
        })),
      }

      onAddGroup(group)
      setPrivateKeys('')
      setPrivateKeyGroupName('')
      setPrivateKeyModalOpen(false)
      message.success(
        `已导入 ${uniqueWallets.length} 个钱包${
          duplicateCount > 0 ? `，跳过 ${duplicateCount} 个重复地址` : ''
        }`,
      )
    } finally {
      setImportingPrivateKeys(false)
    }
  }

  const columns: any[] = [
    {
      title: '#',
      width: 50,
      render: (_: any, r: any, index: number) => r.derivationIndex ?? index + 1,
    },
    {
      title: '地址',
      dataIndex: 'address',
      render: (addr: string) => (
        <Typography.Text
          copyable={{ text: addr }}
          style={{ fontFamily: 'monospace' }}
        >
          {shortenAddress(addr, 10)}
        </Typography.Text>
      ),
    },
    {
      title: 'SOL 余额',
      width: 130,
      dataIndex: 'solBalance',
      render: (val?: number) =>
        val != null ? (
          <Typography.Text style={{ fontFamily: 'monospace' }}>
            {val.toFixed(4)}
          </Typography.Text>
        ) : (
          <Typography.Text type="secondary">--</Typography.Text>
        ),
    },
  ]

  if (tokenType === 'SPL') {
    columns.push({
      title: tokenSymbol || '代币余额',
      width: 140,
      dataIndex: 'tokenBalance',
      render: (val?: number) =>
        val != null ? (
          <Typography.Text style={{ fontFamily: 'monospace' }}>
            {val.toFixed(4)}
          </Typography.Text>
        ) : (
          <Typography.Text type="secondary">--</Typography.Text>
        ),
    })
  }

  columns.push({
    title: '路径',
    width: 180,
    render: (_: any, r: any) => (
      <Typography.Text
        type="secondary"
        style={{ fontFamily: 'monospace', fontSize: 12 }}
      >
        {r.derivationIndex == null
          ? '导入私钥'
          : `m/44'/501'/${r.derivationIndex}'/0'`}
      </Typography.Text>
    ),
  })

  return (
    <div className="wallet-manager">
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 12,
        }}
      >
        <Space>
          <Typography.Text strong style={{ fontSize: 15 }}>
            <KeyOutlined /> 钱包管理
          </Typography.Text>
          {allWalletCount > 0 && (
            <Tag color="blue">
              {groups.length} 组 / {allWalletCount} 个钱包
            </Tag>
          )}
          {hasBalances && (
            <>
              <Tag color="green">合计: {totalSOL.toFixed(4)} SOL</Tag>
              {tokenType === 'SPL' && totalToken > 0 && (
                <Tag color="purple">合计: {totalToken.toFixed(4)} {tokenSymbol}</Tag>
              )}
            </>
          )}
        </Space>
        <Space>
          {allWalletCount > 0 && (
            <Tooltip title="从链上刷新所有钱包余额">
              <Button
                icon={<ReloadOutlined spin={refreshing} />}
                onClick={handleRefresh}
                loading={refreshing}
              >
                刷新余额
              </Button>
            </Tooltip>
          )}
          <Button icon={<ImportOutlined />} onClick={() => setPrivateKeyModalOpen(true)}>
            批量导入私钥
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setModalOpen(true)}>
            导入助记词
          </Button>
        </Space>
      </div>

      {groups.length === 0 ? (
        <Alert
          message="请先导入助记词或私钥添加钱包，所有转账操作都基于已导入的钱包"
          type="info"
          showIcon
        />
      ) : (
        <Collapse
          size="small"
          items={groups.map((group) => ({
            key: group.id,
            label: (
              <Space>
                <span style={{ fontWeight: 500 }}>{group.name}</span>
                <Tag>{group.wallets.length} 个钱包</Tag>
              </Space>
            ),
            extra: (
              <Popconfirm
                title="确定删除该钱包组及所有钱包？"
                onConfirm={(e) => {
                  e?.stopPropagation()
                  onRemoveGroup(group.id)
                }}
                onCancel={(e) => e?.stopPropagation()}
              >
                <Button
                  type="text"
                  danger
                  size="small"
                  icon={<DeleteOutlined />}
                  onClick={(e) => e.stopPropagation()}
                />
              </Popconfirm>
            ),
            children: (
              <Table
                size="small"
                pagination={false}
                scroll={{ y: 240 }}
                dataSource={group.wallets}
                rowKey="address"
                columns={columns}
              />
            ),
          }))}
        />
      )}

      <Modal
        title="导入助记词"
        open={modalOpen}
        onCancel={() => {
          setModalOpen(false)
          setMnemonic('')
          setGroupName('')
        }}
        onOk={handleImport}
        okText="生成钱包"
        cancelText="取消"
        width={560}
        destroyOnClose
        confirmLoading={generating}
        okButtonProps={{ disabled: generating }}
        cancelButtonProps={{ disabled: generating }}
      >
        <Space direction="vertical" style={{ width: '100%' }} size="middle">
          <Alert
            type="warning"
            showIcon
            message="助记词仅保留在内存中，关闭应用后自动清除，不会持久化"
          />
          <Form layout="vertical">
            <Form.Item label="助记词">
              <Input.TextArea
                placeholder="输入 12 或 24 个助记词，以空格分隔"
                value={mnemonic}
                onChange={(e) => setMnemonic(e.target.value)}
                rows={3}
                style={{ fontFamily: 'monospace' }}
              />
            </Form.Item>
            <Form.Item label="备注名称（可选）">
              <Input
                placeholder="如: 主钱包、交易钱包..."
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
              />
            </Form.Item>
            <Space size="large">
              <Form.Item label="起始序号" style={{ marginBottom: 0 }}>
                <InputNumber
                  value={startIndex}
                  onChange={(v) => setStartIndex(v ?? 0)}
                  min={0}
                  style={{ width: 100 }}
                />
              </Form.Item>
              <Form.Item label="生成数量" style={{ marginBottom: 0 }}>
                <InputNumber
                  value={count}
                  onChange={(v) => setCount(v ?? 1)}
                  min={1}
                  max={1000}
                  style={{ width: 100 }}
                />
              </Form.Item>
            </Space>
          </Form>
        </Space>
      </Modal>

      <Modal
        title="批量导入私钥"
        open={privateKeyModalOpen}
        onCancel={() => {
          setPrivateKeyModalOpen(false)
          setPrivateKeys('')
          setPrivateKeyGroupName('')
        }}
        onOk={handlePrivateKeyImport}
        okText="导入钱包"
        cancelText="取消"
        width={640}
        destroyOnClose
        confirmLoading={importingPrivateKeys}
        okButtonProps={{ disabled: importingPrivateKeys }}
        cancelButtonProps={{ disabled: importingPrivateKeys }}
      >
        <Space direction="vertical" style={{ width: '100%' }} size="middle">
          <Alert
            type="warning"
            showIcon
            message="私钥仅保留在内存中，关闭应用后自动清除，不会持久化"
            description="请确保当前环境安全，不要导入仍在其他重要场景使用的私钥。"
          />
          <Form layout="vertical">
            <Form.Item label="私钥列表">
              <Input.TextArea
                placeholder={'每行输入一个私钥，支持 Base58 或 JSON 数组格式\n例如：3Xf...abc\n或：[12,34,...,56]'}
                value={privateKeys}
                onChange={(e) => setPrivateKeys(e.target.value)}
                rows={10}
                style={{ fontFamily: 'monospace' }}
              />
            </Form.Item>
            <Form.Item label="备注名称（可选）" style={{ marginBottom: 0 }}>
              <Input
                placeholder="如：批量钱包、交易钱包..."
                value={privateKeyGroupName}
                onChange={(e) => setPrivateKeyGroupName(e.target.value)}
              />
            </Form.Item>
          </Form>
        </Space>
      </Modal>
    </div>
  )
}

export default WalletManager
