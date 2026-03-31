import React, { useState, useRef } from 'react'
import {
  Input,
  Button,
  Table,
  Tag,
  Space,
  message,
  Typography,
  Tooltip,
  InputNumber,
  Alert,
  Upload,
  Radio,
} from 'antd'
import {
  PlusOutlined,
  DeleteOutlined,
  PlayCircleOutlined,
  ClearOutlined,
  UploadOutlined,
  DownloadOutlined,
  UsergroupAddOutlined,
  TeamOutlined,
} from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import type { TransferConfig, SenderRow, TransferStatus, ManagedWallet, AmountMode } from '../types'
import {
  getConnection,
  keypairFromPrivateKey,
  transferSOL,
  transferSPLToken,
  transferAllSOL,
  transferAllSPLToken,
  randomAmount,
  getExplorerUrl,
  shortenAddress,
  runWithConcurrency,
} from '../services/solana'
import WalletSelect from './WalletSelect'
import WalletPickerModal from './WalletPickerModal'
import { PublicKey } from '@solana/web3.js'
import Papa from 'papaparse'

const { Text, Link } = Typography

const STATUS_MAP: Record<TransferStatus, { color: string; text: string }> = {
  pending: { color: 'default', text: '等待中' },
  processing: { color: 'processing', text: '处理中' },
  success: { color: 'success', text: '成功' },
  failed: { color: 'error', text: '失败' },
}

interface Props {
  config: TransferConfig
  wallets: ManagedWallet[]
}

const ManyToOne: React.FC<Props> = ({ config, wallets }) => {
  const [recipientAddress, setRecipientAddress] = useState('')
  const [senders, setSenders] = useState<SenderRow[]>([])
  const [executing, setExecuting] = useState(false)
  const [selectedWallet, setSelectedWallet] = useState<string>('')
  const [newAmount, setNewAmount] = useState<number | null>(null)
  const [amountMode, setAmountMode] = useState<AmountMode>('fixed')
  const [rangeMin, setRangeMin] = useState<number | null>(null)
  const [rangeMax, setRangeMax] = useState<number | null>(null)
  const cancelRef = useRef(false)

  const [senderPickerOpen, setSenderPickerOpen] = useState(false)
  const [recipientPickerOpen, setRecipientPickerOpen] = useState(false)
  const [concurrency, setConcurrency] = useState(5)

  const resolveAmount = (): number => {
    if (amountMode === 'all') return 0
    if (amountMode === 'range') {
      if (rangeMin && rangeMax && rangeMin > 0 && rangeMax >= rangeMin)
        return randomAmount(rangeMin, rangeMax)
      return 0
    }
    return newAmount ?? 0
  }

  const addSender = () => {
    const wallet = wallets.find((w) => w.address === selectedWallet)
    if (!wallet) return message.warning('请选择钱包')
    if (amountMode === 'fixed' && (!newAmount || newAmount <= 0))
      return message.warning('请输入有效金额')
    if (amountMode === 'range' && (!rangeMin || !rangeMax || rangeMin <= 0 || rangeMax < rangeMin))
      return message.warning('请输入有效的金额范围')

    setSenders((prev) => [
      ...prev,
      {
        key: `${Date.now()}-${Math.random()}`,
        walletAddress: wallet.address,
        amount: resolveAmount(),
        status: 'pending',
      },
    ])
    setSelectedWallet('')
    if (amountMode === 'fixed') setNewAmount(null)
  }

  const handleSenderPickerConfirm = (addresses: string[]) => {
    if (amountMode === 'fixed' && (!newAmount || newAmount <= 0)) {
      message.warning('请先设置固定金额')
      return
    }
    if (amountMode === 'range' && (!rangeMin || !rangeMax || rangeMin <= 0 || rangeMax < rangeMin)) {
      message.warning('请先设置有效的金额范围')
      return
    }
    const items: SenderRow[] = addresses.map((addr) => {
      let amount = 0
      if (amountMode === 'fixed') amount = newAmount!
      else if (amountMode === 'range') amount = randomAmount(rangeMin!, rangeMax!)
      return {
        key: `${Date.now()}-${Math.random()}`,
        walletAddress: addr,
        amount,
        status: 'pending' as const,
      }
    })
    setSenders((prev) => [...prev, ...items])
    setSenderPickerOpen(false)
    message.success(`已添加 ${items.length} 个发送方`)
  }

  const handleRecipientPickerConfirm = (addresses: string[]) => {
    if (addresses.length > 0) {
      setRecipientAddress(addresses[0])
    }
    setRecipientPickerOpen(false)
  }

  const handleCSVUpload = (file: File) => {
    Papa.parse(file, {
      skipEmptyLines: true,
      complete: (results) => {
        const rows = results.data as string[][]
        const items: SenderRow[] = []
        for (const row of rows) {
          const addr = row[0]?.trim()
          if (!addr || !wallets.some((w) => w.address === addr)) continue
          let amount = 0
          if (amountMode !== 'all') {
            if (row.length >= 2) {
              amount = parseFloat(row[1]?.trim())
              if (isNaN(amount) || amount <= 0) continue
            } else continue
          }
          items.push({ key: `${Date.now()}-${Math.random()}`, walletAddress: addr, amount, status: 'pending' })
        }
        if (items.length > 0) {
          setSenders((prev) => [...prev, ...items])
          message.success(`成功导入 ${items.length} 条记录`)
        } else {
          message.warning('未找到有效数据，CSV 格式: 钱包地址,金额')
        }
      },
      error: () => message.error('CSV 解析失败'),
    })
    return false
  }

  const downloadTemplate = () => {
    const addrs = wallets.slice(0, 3).map((w) => `${w.address},1.0`).join('\n')
    const blob = new Blob([`钱包地址,金额\n${addrs}`], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'many-to-one-template.csv'
    a.click()
  }

  const execute = async () => {
    if (!recipientAddress?.trim()) return message.error('请输入接收方地址')
    try { new PublicKey(recipientAddress.trim()) } catch { return message.error('无效的接收方地址') }
    const pending = senders.filter((s) => s.status !== 'success')
    if (pending.length === 0) return message.warning('没有待处理的转账')
    if (config.tokenType === 'SPL' && !config.tokenMint) return message.error('请先查询并确认代币')

    setExecuting(true)
    cancelRef.current = false
    try {
      const connection = getConnection(config.network, config.rpcUrl)
      const recipientPk = new PublicKey(recipientAddress.trim())
      const snapshot = [...senders]
      const pendingIndices = snapshot.map((_, i) => i).filter((i) => snapshot[i].status !== 'success')

      await runWithConcurrency(
        pendingIndices.length,
        concurrency,
        () => cancelRef.current,
        async (queueIdx) => {
          const i = pendingIndices[queueIdx]
          const item = snapshot[i]
          const wallet = wallets.find((w) => w.address === item.walletAddress)
          if (!wallet) {
            setSenders((p) => p.map((s, idx) => (idx === i ? { ...s, status: 'failed', error: '钱包未找到' } : s)))
            return
          }
          setSenders((p) => p.map((s, idx) => (idx === i ? { ...s, status: 'processing', error: undefined } : s)))
          try {
            const sender = keypairFromPrivateKey(wallet.privateKey)
            let txHash: string

            if (amountMode === 'all') {
              txHash =
                config.tokenType === 'SOL'
                  ? await transferAllSOL(connection, sender, recipientPk)
                  : await transferAllSPLToken(
                      connection, sender, recipientPk,
                      new PublicKey(config.tokenMint), config.tokenDecimals,
                    )
            } else {
              txHash =
                config.tokenType === 'SOL'
                  ? await transferSOL(connection, sender, recipientPk, item.amount)
                  : await transferSPLToken(
                      connection, sender, recipientPk,
                      new PublicKey(config.tokenMint), item.amount, config.tokenDecimals,
                    )
            }
            setSenders((p) => p.map((s, idx) => (idx === i ? { ...s, status: 'success', txHash } : s)))
          } catch (err: any) {
            setSenders((p) => p.map((s, idx) => (idx === i ? { ...s, status: 'failed', error: err.message } : s)))
          }
        },
      )
      message.success('执行完毕')
    } catch (err: any) {
      message.error(`执行出错: ${err.message}`)
    } finally {
      setExecuting(false)
    }
  }

  const columns: ColumnsType<SenderRow> = [
    { title: '#', width: 50, render: (_, __, idx) => idx + 1 },
    {
      title: '发送方地址', dataIndex: 'walletAddress', width: 220,
      render: (addr: string) => (
        <Tooltip title={addr}>
          <Text copyable={{ text: addr }} style={{ fontFamily: 'monospace', fontSize: 12 }}>{shortenAddress(addr, 8)}</Text>
        </Tooltip>
      ),
    },
    {
      title: '金额', dataIndex: 'amount', width: 150,
      render: (v: number) =>
        amountMode === 'all'
          ? <Tag color="blue">全部余额</Tag>
          : `${v} ${config.tokenType === 'SOL' ? 'SOL' : config.tokenSymbol}`,
    },
    {
      title: '状态', dataIndex: 'status', width: 100,
      render: (s: TransferStatus) => <Tag color={STATUS_MAP[s].color}>{STATUS_MAP[s].text}</Tag>,
    },
    {
      title: '交易哈希', dataIndex: 'txHash', width: 180,
      render: (hash: string) =>
        hash ? (
          <Link href={getExplorerUrl(hash, config.network)} target="_blank" style={{ fontFamily: 'monospace', fontSize: 12 }}>
            {shortenAddress(hash, 8)}
          </Link>
        ) : '-',
    },
    {
      title: '错误', dataIndex: 'error', ellipsis: true,
      render: (err: string) => err ? <Text type="danger" ellipsis={{ tooltip: err }}>{err}</Text> : '-',
    },
    {
      title: '', width: 50,
      render: (_, record) => (
        <Button type="text" danger icon={<DeleteOutlined />} size="small" disabled={executing}
          onClick={() => setSenders((p) => p.filter((s) => s.key !== record.key))} />
      ),
    },
  ]

  const totalAmount = senders.reduce((s, r) => s + r.amount, 0)
  const successCount = senders.filter((s) => s.status === 'success').length
  const failedCount = senders.filter((s) => s.status === 'failed').length

  return (
    <div className="transfer-card">
      <div className="recipient-info">
        <Space direction="vertical" style={{ width: '100%' }} size="small">
          <Text strong>接收方地址</Text>
          <Space.Compact style={{ width: '100%' }}>
            <Input placeholder="输入或粘贴接收方钱包地址" value={recipientAddress}
              onChange={(e) => setRecipientAddress(e.target.value)} style={{ fontFamily: 'monospace', flex: 1 }} allowClear />
            <Button icon={<TeamOutlined />} onClick={() => setRecipientPickerOpen(true)}>
              从钱包选择
            </Button>
          </Space.Compact>
        </Space>
      </div>

      <div style={{ marginBottom: 12 }}>
        <Text strong style={{ marginRight: 12 }}>金额模式</Text>
        <Radio.Group value={amountMode} onChange={(e) => setAmountMode(e.target.value)}>
          <Radio.Button value="fixed">固定金额</Radio.Button>
          <Radio.Button value="range">随机范围</Radio.Button>
          <Radio.Button value="all">转全部</Radio.Button>
        </Radio.Group>
        {amountMode === 'all' && config.tokenType === 'SOL' && (
          <Text type="secondary" style={{ marginLeft: 12, fontSize: 12 }}>
            每个钱包的 SOL 将全部转出（自动扣除手续费）
          </Text>
        )}
      </div>

      <div className="action-bar">
        <Space wrap>
          <Space.Compact>
            <WalletSelect wallets={wallets} value={selectedWallet || undefined}
              onChange={setSelectedWallet} placeholder="选择发送方钱包" style={{ width: 300 }} />
            {amountMode === 'fixed' && (
              <InputNumber placeholder="金额" value={newAmount} onChange={(v) => setNewAmount(v)}
                min={0} step={0.01} style={{ width: 130 }} />
            )}
            {amountMode === 'range' && (
              <>
                <InputNumber placeholder="最小" value={rangeMin} onChange={(v) => setRangeMin(v)}
                  min={0} step={0.01} style={{ width: 100 }} />
                <InputNumber placeholder="最大" value={rangeMax} onChange={(v) => setRangeMax(v)}
                  min={0} step={0.01} style={{ width: 100 }} />
              </>
            )}
            <Button icon={<PlusOutlined />} onClick={addSender}>添加</Button>
          </Space.Compact>
          <Button type="primary" icon={<UsergroupAddOutlined />} onClick={() => setSenderPickerOpen(true)}>
            批量选择发送方
          </Button>
          <Upload accept=".csv" showUploadList={false} beforeUpload={handleCSVUpload}>
            <Button icon={<UploadOutlined />}>导入 CSV</Button>
          </Upload>
          <Button icon={<DownloadOutlined />} onClick={downloadTemplate}>下载模板</Button>
        </Space>
      </div>

      {senders.length > 0 && (
        <>
          <Alert type="info" showIcon style={{ marginBottom: 16 }} message={
            <Space split="|">
              <span>共 {senders.length} 笔</span>
              {amountMode !== 'all' && <span>总金额: {totalAmount.toFixed(6)}</span>}
              {amountMode === 'all' && <span>模式: 转全部余额</span>}
              {successCount > 0 && <span style={{ color: '#52c41a' }}>成功: {successCount}</span>}
              {failedCount > 0 && <span style={{ color: '#ff4d4f' }}>失败: {failedCount}</span>}
            </Space>
          } />
          <Table columns={columns} dataSource={senders} pagination={false} size="small"
            scroll={{ y: 400 }} style={{ marginBottom: 16 }} />
          <Space wrap>
            {executing ? (
              <Button danger onClick={() => (cancelRef.current = true)}>停止执行</Button>
            ) : (
              <Button type="primary" icon={<PlayCircleOutlined />} onClick={execute} size="large">开始转账</Button>
            )}
            {failedCount > 0 && !executing && (
              <Button onClick={() => setSenders((p) => p.map((s) =>
                s.status === 'failed' ? { ...s, status: 'pending', error: undefined } : s))}>
                重试失败项
              </Button>
            )}
            <Button icon={<ClearOutlined />} onClick={() => setSenders([])} disabled={executing}>清空列表</Button>
            <Space size={4}>
              <Text type="secondary">并发数:</Text>
              <InputNumber min={1} max={20} value={concurrency} onChange={(v) => setConcurrency(v ?? 5)}
                disabled={executing} size="small" style={{ width: 70 }} />
            </Space>
          </Space>
        </>
      )}

      <WalletPickerModal
        open={senderPickerOpen}
        wallets={wallets}
        onConfirm={handleSenderPickerConfirm}
        onCancel={() => setSenderPickerOpen(false)}
        title="批量选择发送方钱包"
      />
      <WalletPickerModal
        open={recipientPickerOpen}
        wallets={wallets}
        onConfirm={handleRecipientPickerConfirm}
        onCancel={() => setRecipientPickerOpen(false)}
        title="从钱包选择接收方"
      />
    </div>
  )
}

export default ManyToOne
