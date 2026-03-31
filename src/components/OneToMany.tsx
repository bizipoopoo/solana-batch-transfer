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
  TeamOutlined,
} from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import type { TransferConfig, RecipientRow, TransferStatus, ManagedWallet } from '../types'
import {
  getConnection,
  keypairFromPrivateKey,
  transferSOL,
  transferSPLToken,
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

type SimpleAmountMode = 'fixed' | 'range'

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

const OneToMany: React.FC<Props> = ({ config, wallets }) => {
  const [senderAddress, setSenderAddress] = useState<string>('')
  const [recipients, setRecipients] = useState<RecipientRow[]>([])
  const [executing, setExecuting] = useState(false)
  const [newAddress, setNewAddress] = useState('')
  const [newAmount, setNewAmount] = useState<number | null>(null)
  const [amountMode, setAmountMode] = useState<SimpleAmountMode>('fixed')
  const [rangeMin, setRangeMin] = useState<number | null>(null)
  const [rangeMax, setRangeMax] = useState<number | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [concurrency, setConcurrency] = useState(5)
  const cancelRef = useRef(false)

  const senderWallet = wallets.find((w) => w.address === senderAddress)

  const addRecipient = () => {
    if (!newAddress?.trim()) return message.warning('请输入接收地址')
    try {
      new PublicKey(newAddress.trim())
    } catch {
      return message.error('无效的 Solana 地址')
    }

    let amount = 0
    if (amountMode === 'fixed') {
      if (!newAmount || newAmount <= 0) return message.warning('请输入有效金额')
      amount = newAmount
    } else {
      if (!rangeMin || !rangeMax || rangeMin <= 0 || rangeMax <= 0 || rangeMin > rangeMax)
        return message.warning('请输入有效的金额范围（最小值 ≤ 最大值）')
      amount = randomAmount(rangeMin, rangeMax)
    }

    setRecipients((prev) => [
      ...prev,
      { key: `${Date.now()}-${Math.random()}`, address: newAddress.trim(), amount, status: 'pending' },
    ])
    setNewAddress('')
    if (amountMode === 'fixed') setNewAmount(null)
  }

  const handlePickerConfirm = (addresses: string[]) => {
    if (amountMode === 'fixed' && (!newAmount || newAmount <= 0)) {
      message.warning('请先在金额框中输入固定金额')
      return
    }
    if (amountMode === 'range' && (!rangeMin || !rangeMax || rangeMin <= 0 || rangeMax < rangeMin)) {
      message.warning('请先设置有效的金额范围')
      return
    }
    const items: RecipientRow[] = addresses.map((addr) => ({
      key: `${Date.now()}-${Math.random()}`,
      address: addr,
      amount: amountMode === 'fixed' ? (newAmount ?? 0) : randomAmount(rangeMin!, rangeMax!),
      status: 'pending' as const,
    }))
    setRecipients((prev) => [...prev, ...items])
    setPickerOpen(false)
    message.success(`已添加 ${items.length} 个接收方`)
  }

  const handleCSVUpload = (file: File) => {
    Papa.parse(file, {
      skipEmptyLines: true,
      complete: (results) => {
        const rows = results.data as string[][]
        const items: RecipientRow[] = []
        for (const row of rows) {
          const address = row[0]?.trim()
          if (!address) continue
          let amount = 0
          if (row.length >= 2) {
            amount = parseFloat(row[1]?.trim())
            if (isNaN(amount) || amount <= 0) continue
          } else if (amountMode === 'range' && rangeMin && rangeMax) {
            amount = randomAmount(rangeMin, rangeMax)
          } else continue
          items.push({ key: `${Date.now()}-${Math.random()}`, address, amount, status: 'pending' })
        }
        if (items.length > 0) {
          setRecipients((prev) => [...prev, ...items])
          message.success(`成功导入 ${items.length} 条记录`)
        } else {
          message.warning('未找到有效数据，CSV 格式: 地址,金额')
        }
      },
      error: () => message.error('CSV 解析失败'),
    })
    return false
  }

  const downloadTemplate = () => {
    const blob = new Blob(['地址,金额\n接收地址1,1.5\n接收地址2,2.0'], {
      type: 'text/csv;charset=utf-8',
    })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'one-to-many-template.csv'
    a.click()
  }

  const execute = async () => {
    if (!senderWallet) return message.error('请选择发送方钱包')
    const pending = recipients.filter((r) => r.status !== 'success')
    if (pending.length === 0) return message.warning('没有待处理的转账')
    if (config.tokenType === 'SPL' && !config.tokenMint)
      return message.error('请先查询并确认代币')

    setExecuting(true)
    cancelRef.current = false
    try {
      const connection = getConnection(config.network, config.rpcUrl)
      const sender = keypairFromPrivateKey(senderWallet.privateKey)
      const snapshot = [...recipients]
      const pendingIndices = snapshot.map((_, i) => i).filter((i) => snapshot[i].status !== 'success')

      await runWithConcurrency(
        pendingIndices.length,
        concurrency,
        () => cancelRef.current,
        async (queueIdx) => {
          const i = pendingIndices[queueIdx]
          const item = snapshot[i]
          setRecipients((p) =>
            p.map((r, idx) => (idx === i ? { ...r, status: 'processing', error: undefined } : r)),
          )
          try {
            const recipientPk = new PublicKey(item.address)
            const txHash =
              config.tokenType === 'SOL'
                ? await transferSOL(connection, sender, recipientPk, item.amount)
                : await transferSPLToken(
                    connection, sender, recipientPk,
                    new PublicKey(config.tokenMint), item.amount, config.tokenDecimals,
                  )
            setRecipients((p) => p.map((r, idx) => (idx === i ? { ...r, status: 'success', txHash } : r)))
          } catch (err: any) {
            setRecipients((p) =>
              p.map((r, idx) => (idx === i ? { ...r, status: 'failed', error: err.message } : r)),
            )
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

  const columns: ColumnsType<RecipientRow> = [
    { title: '#', width: 50, render: (_, __, idx) => idx + 1 },
    {
      title: '接收地址', dataIndex: 'address', ellipsis: true,
      render: (addr: string) => (
        <Tooltip title={addr}>
          <Text copyable={{ text: addr }} style={{ fontFamily: 'monospace' }}>{shortenAddress(addr, 8)}</Text>
        </Tooltip>
      ),
    },
    {
      title: '金额', dataIndex: 'amount', width: 150,
      render: (v: number) => `${v} ${config.tokenType === 'SOL' ? 'SOL' : config.tokenSymbol}`,
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
      title: '错误', dataIndex: 'error', width: 200, ellipsis: true,
      render: (err: string) => err ? <Text type="danger" ellipsis={{ tooltip: err }}>{err}</Text> : '-',
    },
    {
      title: '', width: 50,
      render: (_, record) => (
        <Button type="text" danger icon={<DeleteOutlined />} size="small" disabled={executing}
          onClick={() => setRecipients((p) => p.filter((r) => r.key !== record.key))} />
      ),
    },
  ]

  const totalAmount = recipients.reduce((s, r) => s + r.amount, 0)
  const successCount = recipients.filter((r) => r.status === 'success').length
  const failedCount = recipients.filter((r) => r.status === 'failed').length

  return (
    <div className="transfer-card">
      <div className="sender-info">
        <Space direction="vertical" style={{ width: '100%' }} size="small">
          <Text strong>发送方钱包</Text>
          <WalletSelect
            wallets={wallets}
            value={senderAddress || undefined}
            onChange={setSenderAddress}
            placeholder="选择一个钱包作为发送方"
            style={{ width: '100%' }}
          />
          {senderWallet && (
            <Text type="secondary" style={{ fontFamily: 'monospace', fontSize: 12 }}>
              {senderWallet.address}
            </Text>
          )}
        </Space>
      </div>

      <div style={{ marginBottom: 12 }}>
        <Text strong style={{ marginRight: 12 }}>金额模式</Text>
        <Radio.Group value={amountMode} onChange={(e) => setAmountMode(e.target.value)}>
          <Radio.Button value="fixed">固定金额</Radio.Button>
          <Radio.Button value="range">随机范围</Radio.Button>
        </Radio.Group>
      </div>

      <div className="action-bar">
        <Space wrap>
          <Space.Compact>
            <Input placeholder="接收地址（可粘贴任意地址）" value={newAddress} onChange={(e) => setNewAddress(e.target.value)}
              style={{ width: 380 }} onPressEnter={addRecipient} />
            {amountMode === 'fixed' && (
              <InputNumber placeholder="金额" value={newAmount} onChange={(v) => setNewAmount(v)}
                min={0} step={0.01} style={{ width: 130 }} onPressEnter={addRecipient} />
            )}
            {amountMode === 'range' && (
              <>
                <InputNumber placeholder="最小" value={rangeMin} onChange={(v) => setRangeMin(v)}
                  min={0} step={0.01} style={{ width: 100 }} />
                <InputNumber placeholder="最大" value={rangeMax} onChange={(v) => setRangeMax(v)}
                  min={0} step={0.01} style={{ width: 100 }} />
              </>
            )}
            <Button icon={<PlusOutlined />} onClick={addRecipient}>添加</Button>
          </Space.Compact>
          <Button icon={<TeamOutlined />} onClick={() => setPickerOpen(true)}>从钱包选择</Button>
          <Upload accept=".csv" showUploadList={false} beforeUpload={handleCSVUpload}>
            <Button icon={<UploadOutlined />}>导入 CSV</Button>
          </Upload>
          <Button icon={<DownloadOutlined />} onClick={downloadTemplate}>下载模板</Button>
        </Space>
      </div>

      {recipients.length > 0 && (
        <>
          <Alert type="info" showIcon style={{ marginBottom: 16 }} message={
            <Space split="|">
              <span>共 {recipients.length} 笔</span>
              <span>总金额: {totalAmount.toFixed(6)}</span>
              {successCount > 0 && <span style={{ color: '#52c41a' }}>成功: {successCount}</span>}
              {failedCount > 0 && <span style={{ color: '#ff4d4f' }}>失败: {failedCount}</span>}
            </Space>
          } />
          <Table columns={columns} dataSource={recipients} pagination={false} size="small"
            scroll={{ y: 400 }} style={{ marginBottom: 16 }} />
          <Space wrap>
            {executing ? (
              <Button danger onClick={() => (cancelRef.current = true)}>停止执行</Button>
            ) : (
              <Button type="primary" icon={<PlayCircleOutlined />} onClick={execute} size="large">开始转账</Button>
            )}
            {failedCount > 0 && !executing && (
              <Button onClick={() => setRecipients((p) => p.map((r) =>
                r.status === 'failed' ? { ...r, status: 'pending', error: undefined } : r))}>
                重试失败项
              </Button>
            )}
            <Button icon={<ClearOutlined />} onClick={() => setRecipients([])} disabled={executing}>清空列表</Button>
            <Space size={4}>
              <Text type="secondary">并发数:</Text>
              <InputNumber min={1} max={20} value={concurrency} onChange={(v) => setConcurrency(v ?? 5)}
                disabled={executing} size="small" style={{ width: 70 }} />
            </Space>
          </Space>
        </>
      )}
      <WalletPickerModal
        open={pickerOpen}
        wallets={wallets}
        onConfirm={handlePickerConfirm}
        onCancel={() => setPickerOpen(false)}
        title="选择接收方钱包"
      />
    </div>
  )
}

export default OneToMany
