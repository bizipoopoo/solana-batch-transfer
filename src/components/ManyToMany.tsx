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
  Modal,
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
import type { TransferConfig, PairRow, TransferStatus, ManagedWallet, AmountMode } from '../types'
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

const ManyToMany: React.FC<Props> = ({ config, wallets }) => {
  const [pairs, setPairs] = useState<PairRow[]>([])
  const [executing, setExecuting] = useState(false)
  const [newSender, setNewSender] = useState<string>('')
  const [newRecipient, setNewRecipient] = useState('')
  const [newAmount, setNewAmount] = useState<number | null>(null)
  const [amountMode, setAmountMode] = useState<AmountMode>('fixed')
  const [rangeMin, setRangeMin] = useState<number | null>(null)
  const [rangeMax, setRangeMax] = useState<number | null>(null)
  const [concurrency, setConcurrency] = useState(5)
  const cancelRef = useRef(false)

  // Batch add state
  const [batchOpen, setBatchOpen] = useState(false)
  const [batchSenders, setBatchSenders] = useState<string[]>([])
  const [batchRecipients, setBatchRecipients] = useState<string[]>([])
  const [batchRecipientsText, setBatchRecipientsText] = useState('')
  const [batchAmount, setBatchAmount] = useState<number | null>(null)

  // Picker modals
  const [senderPickerOpen, setSenderPickerOpen] = useState(false)
  const [recipientPickerOpen, setRecipientPickerOpen] = useState(false)
  const [batchSenderPickerOpen, setBatchSenderPickerOpen] = useState(false)
  const [batchRecipientPickerOpen, setBatchRecipientPickerOpen] = useState(false)

  const allBatchRecipientAddrs = [
    ...batchRecipients,
    ...batchRecipientsText.split('\n').map((l) => l.trim()).filter(Boolean),
  ]

  const addPair = () => {
    if (!newSender) return message.warning('请选择发送方钱包')
    if (!newRecipient?.trim()) return message.warning('请输入接收地址')
    try { new PublicKey(newRecipient.trim()) } catch { return message.error('无效的接收地址') }

    let amount = 0
    if (amountMode === 'fixed') {
      if (!newAmount || newAmount <= 0) return message.warning('请输入有效金额')
      amount = newAmount
    } else if (amountMode === 'range') {
      if (!rangeMin || !rangeMax || rangeMin <= 0 || rangeMax < rangeMin)
        return message.warning('请输入有效的金额范围')
      amount = randomAmount(rangeMin, rangeMax)
    }

    setPairs((prev) => [
      ...prev,
      {
        key: `${Date.now()}-${Math.random()}`,
        senderAddress: newSender,
        recipientAddress: newRecipient.trim(),
        amount,
        status: 'pending',
      },
    ])
    setNewSender('')
    setNewRecipient('')
    if (amountMode === 'fixed') setNewAmount(null)
  }

  // Single-row: pick recipients from wallet for current sender
  const handleRecipientPickerConfirm = (addresses: string[]) => {
    if (!newSender) {
      message.warning('请先选择发送方钱包')
      setRecipientPickerOpen(false)
      return
    }
    const items: PairRow[] = addresses.map((addr) => {
      let amount = 0
      if (amountMode === 'fixed') amount = newAmount ?? 0
      else if (amountMode === 'range' && rangeMin && rangeMax) amount = randomAmount(rangeMin, rangeMax)
      return {
        key: `${Date.now()}-${Math.random()}`,
        senderAddress: newSender,
        recipientAddress: addr,
        amount,
        status: 'pending' as const,
      }
    })
    setPairs((prev) => [...prev, ...items])
    setRecipientPickerOpen(false)
    message.success(`已添加 ${items.length} 笔转账对`)
  }

  // Batch add: confirm
  const handleBatchAdd = () => {
    const recipients = allBatchRecipientAddrs
    if (batchSenders.length === 0) return message.warning('请选择发送方钱包')
    if (recipients.length === 0) return message.warning('请选择或输入接收方地址')
    if (batchSenders.length !== recipients.length) {
      return message.error(`发送方 (${batchSenders.length}) 和接收方 (${recipients.length}) 数量不匹配，必须一一对应`)
    }
    if (amountMode === 'fixed' && (!batchAmount || batchAmount <= 0))
      return message.warning('请输入金额')
    if (amountMode === 'range' && (!rangeMin || !rangeMax || rangeMin <= 0 || rangeMax < rangeMin))
      return message.warning('请输入有效的金额范围')

    const items: PairRow[] = batchSenders.map((addr, i) => {
      let amount = 0
      if (amountMode === 'fixed') amount = batchAmount!
      else if (amountMode === 'range') amount = randomAmount(rangeMin!, rangeMax!)
      return {
        key: `${Date.now()}-${Math.random()}`,
        senderAddress: addr,
        recipientAddress: recipients[i],
        amount,
        status: 'pending' as const,
      }
    })
    setPairs((prev) => [...prev, ...items])
    setBatchOpen(false)
    setBatchSenders([])
    setBatchRecipients([])
    setBatchRecipientsText('')
    setBatchAmount(null)
    message.success(`已添加 ${items.length} 笔转账对`)
  }

  const handleCSVUpload = (file: File) => {
    Papa.parse(file, {
      skipEmptyLines: true,
      complete: (results) => {
        const rows = results.data as string[][]
        const items: PairRow[] = []
        for (const row of rows) {
          if (row.length < 2) continue
          const sAddr = row[0]?.trim()
          const rAddr = row[1]?.trim()
          if (!sAddr || !rAddr || !wallets.some((w) => w.address === sAddr)) continue
          let amount = 0
          if (amountMode !== 'all') {
            if (row.length >= 3) {
              amount = parseFloat(row[2]?.trim())
              if (isNaN(amount) || amount <= 0) continue
            } else if (amountMode === 'range' && rangeMin && rangeMax) {
              amount = randomAmount(rangeMin, rangeMax)
            } else continue
          }
          items.push({
            key: `${Date.now()}-${Math.random()}`,
            senderAddress: sAddr, recipientAddress: rAddr, amount, status: 'pending',
          })
        }
        if (items.length > 0) {
          setPairs((prev) => [...prev, ...items])
          message.success(`成功导入 ${items.length} 条记录`)
        } else {
          message.warning('未找到有效数据，CSV 格式: 发送方地址,接收地址,金额')
        }
      },
      error: () => message.error('CSV 解析失败'),
    })
    return false
  }

  const downloadTemplate = () => {
    const addrs = wallets.slice(0, 2).map((w) => `${w.address},接收地址,1.0`).join('\n')
    const blob = new Blob([`发送方地址,接收地址,金额\n${addrs}`], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'many-to-many-template.csv'
    a.click()
  }

  const execute = async () => {
    const pending = pairs.filter((p) => p.status !== 'success')
    if (pending.length === 0) return message.warning('没有待处理的转账')
    if (config.tokenType === 'SPL' && !config.tokenMint) return message.error('请先查询并确认代币')

    setExecuting(true)
    cancelRef.current = false
    try {
      const connection = getConnection(config.network, config.rpcUrl)
      const snapshot = [...pairs]
      const pendingIndices = snapshot.map((_, i) => i).filter((i) => snapshot[i].status !== 'success')

      await runWithConcurrency(
        pendingIndices.length,
        concurrency,
        () => cancelRef.current,
        async (queueIdx) => {
          const i = pendingIndices[queueIdx]
          const item = snapshot[i]
          const wallet = wallets.find((w) => w.address === item.senderAddress)
          if (!wallet) {
            setPairs((p) => p.map((r, idx) => (idx === i ? { ...r, status: 'failed', error: '钱包未找到' } : r)))
            return
          }
          setPairs((p) => p.map((r, idx) => (idx === i ? { ...r, status: 'processing', error: undefined } : r)))
          try {
            const sender = keypairFromPrivateKey(wallet.privateKey)
            const recipientPk = new PublicKey(item.recipientAddress)
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
            setPairs((p) => p.map((r, idx) => (idx === i ? { ...r, status: 'success', txHash } : r)))
          } catch (err: any) {
            setPairs((p) => p.map((r, idx) => (idx === i ? { ...r, status: 'failed', error: err.message } : r)))
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

  const columns: ColumnsType<PairRow> = [
    { title: '#', width: 50, render: (_, __, idx) => idx + 1 },
    {
      title: '发送方', dataIndex: 'senderAddress', width: 180,
      render: (addr: string) => (
        <Tooltip title={addr}>
          <Text style={{ fontFamily: 'monospace', fontSize: 12 }}>{shortenAddress(addr, 6)}</Text>
        </Tooltip>
      ),
    },
    {
      title: '接收方', dataIndex: 'recipientAddress', width: 180,
      render: (addr: string) => (
        <Tooltip title={addr}>
          <Text style={{ fontFamily: 'monospace', fontSize: 12 }}>{shortenAddress(addr, 6)}</Text>
        </Tooltip>
      ),
    },
    {
      title: '金额', dataIndex: 'amount', width: 130,
      render: (v: number) =>
        amountMode === 'all'
          ? <Tag color="blue">全部余额</Tag>
          : `${v} ${config.tokenType === 'SOL' ? 'SOL' : config.tokenSymbol}`,
    },
    {
      title: '状态', dataIndex: 'status', width: 90,
      render: (s: TransferStatus) => <Tag color={STATUS_MAP[s].color}>{STATUS_MAP[s].text}</Tag>,
    },
    {
      title: '交易哈希', dataIndex: 'txHash', width: 160,
      render: (hash: string) =>
        hash ? (
          <Link href={getExplorerUrl(hash, config.network)} target="_blank" style={{ fontFamily: 'monospace', fontSize: 12 }}>
            {shortenAddress(hash, 6)}
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
          onClick={() => setPairs((p) => p.filter((r) => r.key !== record.key))} />
      ),
    },
  ]

  const totalAmount = pairs.reduce((s, p) => s + p.amount, 0)
  const successCount = pairs.filter((p) => p.status === 'success').length
  const failedCount = pairs.filter((p) => p.status === 'failed').length

  const senderCountMatch = batchSenders.length === allBatchRecipientAddrs.length
  const batchCountColor = senderCountMatch && batchSenders.length > 0 ? 'green' : 'red'

  return (
    <div className="transfer-card">
      <Alert type="info" showIcon message="多对多模式：每行指定一个发送方钱包和一个接收方，一一对应转账"
        style={{ marginBottom: 16 }} />

      <div style={{ marginBottom: 12 }}>
        <Text strong style={{ marginRight: 12 }}>金额模式</Text>
        <Radio.Group value={amountMode} onChange={(e) => setAmountMode(e.target.value)}>
          <Radio.Button value="fixed">固定金额</Radio.Button>
          <Radio.Button value="range">随机范围</Radio.Button>
          <Radio.Button value="all">转全部</Radio.Button>
        </Radio.Group>
        {amountMode === 'all' && config.tokenType === 'SOL' && (
          <Text type="secondary" style={{ marginLeft: 12, fontSize: 12 }}>
            每个发送方将全部转出（自动扣除手续费）
          </Text>
        )}
      </div>

      <div className="action-bar">
        <Space wrap>
          <WalletSelect wallets={wallets} value={newSender || undefined}
            onChange={setNewSender} placeholder="选择发送方" style={{ width: 240 }} />
          <Input placeholder="接收地址（可粘贴任意地址）" value={newRecipient}
            onChange={(e) => setNewRecipient(e.target.value)} style={{ width: 240 }} />
          {amountMode === 'fixed' && (
            <InputNumber placeholder="金额" value={newAmount} onChange={(v) => setNewAmount(v)}
              min={0} step={0.01} style={{ width: 120 }} />
          )}
          {amountMode === 'range' && (
            <>
              <InputNumber placeholder="最小" value={rangeMin} onChange={(v) => setRangeMin(v)}
                min={0} step={0.01} style={{ width: 100 }} />
              <InputNumber placeholder="最大" value={rangeMax} onChange={(v) => setRangeMax(v)}
                min={0} step={0.01} style={{ width: 100 }} />
            </>
          )}
          <Button icon={<PlusOutlined />} onClick={addPair}>添加</Button>
          <Button icon={<TeamOutlined />} onClick={() => setRecipientPickerOpen(true)}>从钱包选接收方</Button>
          <Button type="primary" icon={<UsergroupAddOutlined />} onClick={() => setBatchOpen(true)}>批量配对</Button>
          <Upload accept=".csv" showUploadList={false} beforeUpload={handleCSVUpload}>
            <Button icon={<UploadOutlined />}>导入 CSV</Button>
          </Upload>
          <Button icon={<DownloadOutlined />} onClick={downloadTemplate}>下载模板</Button>
        </Space>
      </div>

      {pairs.length > 0 && (
        <>
          <Alert type="info" showIcon style={{ marginBottom: 16 }} message={
            <Space split="|">
              <span>共 {pairs.length} 笔</span>
              {amountMode !== 'all' && <span>总金额: {totalAmount.toFixed(6)}</span>}
              {amountMode === 'all' && <span>模式: 转全部余额</span>}
              {successCount > 0 && <span style={{ color: '#52c41a' }}>成功: {successCount}</span>}
              {failedCount > 0 && <span style={{ color: '#ff4d4f' }}>失败: {failedCount}</span>}
            </Space>
          } />
          <Table columns={columns} dataSource={pairs} pagination={false} size="small"
            scroll={{ y: 400 }} style={{ marginBottom: 16 }} />
          <Space wrap>
            {executing ? (
              <Button danger onClick={() => (cancelRef.current = true)}>停止执行</Button>
            ) : (
              <Button type="primary" icon={<PlayCircleOutlined />} onClick={execute} size="large">开始转账</Button>
            )}
            {failedCount > 0 && !executing && (
              <Button onClick={() => setPairs((p) => p.map((r) =>
                r.status === 'failed' ? { ...r, status: 'pending', error: undefined } : r))}>
                重试失败项
              </Button>
            )}
            <Button icon={<ClearOutlined />} onClick={() => setPairs([])} disabled={executing}>清空列表</Button>
            <Space size={4}>
              <Text type="secondary">并发数:</Text>
              <InputNumber min={1} max={20} value={concurrency} onChange={(v) => setConcurrency(v ?? 5)}
                disabled={executing} size="small" style={{ width: 70 }} />
            </Space>
          </Space>
        </>
      )}

      {/* Batch pairing modal */}
      <Modal title="批量配对转账" open={batchOpen}
        onCancel={() => { setBatchOpen(false); setBatchSenders([]); setBatchRecipients([]); setBatchRecipientsText(''); setBatchAmount(null) }}
        onOk={handleBatchAdd} okText="生成配对" cancelText="取消" width={700}
        okButtonProps={{ disabled: !senderCountMatch || batchSenders.length === 0 }}
      >
        <Space direction="vertical" style={{ width: '100%' }} size="middle">
          <Tag color={batchCountColor} style={{ fontSize: 14, padding: '4px 12px' }}>
            发送方: {batchSenders.length} 个 | 接收方: {allBatchRecipientAddrs.length} 个
            {senderCountMatch && batchSenders.length > 0 ? ' ✓ 匹配' : ' ✗ 不匹配'}
          </Tag>

          {/* Senders */}
          <div>
            <Space style={{ marginBottom: 8 }}>
              <Text strong>发送方钱包</Text>
              <Button type="primary" size="small" icon={<TeamOutlined />}
                onClick={() => setBatchSenderPickerOpen(true)}>
                选择发送方（全选/反选）
              </Button>
              {batchSenders.length > 0 && (
                <Tag color="blue">{batchSenders.length} 个已选</Tag>
              )}
            </Space>
            {batchSenders.length > 0 && (
              <div style={{ maxHeight: 100, overflow: 'auto', background: '#fafafa', borderRadius: 6, padding: 8, fontFamily: 'monospace', fontSize: 11 }}>
                {batchSenders.map((addr, i) => (
                  <div key={addr}>#{i + 1} {shortenAddress(addr, 10)}</div>
                ))}
              </div>
            )}
          </div>

          {/* Recipients */}
          <div>
            <Space style={{ marginBottom: 8 }}>
              <Text strong>接收方地址</Text>
              <Button size="small" icon={<TeamOutlined />}
                onClick={() => setBatchRecipientPickerOpen(true)}>
                从钱包选择
              </Button>
              {batchRecipients.length > 0 && (
                <Tag color="blue">{batchRecipients.length} 个从钱包选</Tag>
              )}
            </Space>
            {batchRecipients.length > 0 && (
              <div style={{ maxHeight: 80, overflow: 'auto', background: '#fafafa', borderRadius: 6, padding: 8, fontFamily: 'monospace', fontSize: 11, marginBottom: 8 }}>
                {batchRecipients.map((addr, i) => (
                  <div key={addr}>#{i + 1} {shortenAddress(addr, 10)}</div>
                ))}
              </div>
            )}
            <Input.TextArea
              rows={3}
              placeholder="也可以在此粘贴外部地址（每行一个），将追加到上面已选的钱包地址后面"
              value={batchRecipientsText}
              onChange={(e) => setBatchRecipientsText(e.target.value)}
              style={{ fontFamily: 'monospace' }}
            />
          </div>

          {/* Amount */}
          {amountMode === 'fixed' && (
            <div>
              <Text strong style={{ display: 'block', marginBottom: 8 }}>每笔金额</Text>
              <InputNumber value={batchAmount} onChange={(v) => setBatchAmount(v)}
                min={0} step={0.01} placeholder="统一金额" style={{ width: '100%' }} />
            </div>
          )}
          {amountMode === 'all' && (
            <Alert message="每个发送方将转出全部余额" type="info" showIcon />
          )}
          {amountMode === 'range' && (
            <Alert message={`每笔随机转出 ${rangeMin ?? '?'} ~ ${rangeMax ?? '?'} 之间的金额`} type="info" showIcon />
          )}
        </Space>
      </Modal>

      {/* Picker modals */}
      <WalletPickerModal
        open={recipientPickerOpen}
        wallets={wallets}
        onConfirm={handleRecipientPickerConfirm}
        onCancel={() => setRecipientPickerOpen(false)}
        title="选择接收方钱包"
      />
      <WalletPickerModal
        open={senderPickerOpen}
        wallets={wallets}
        onConfirm={(addrs) => { setSenderPickerOpen(false); /* unused for now */ }}
        onCancel={() => setSenderPickerOpen(false)}
        title="选择发送方钱包"
      />
      <WalletPickerModal
        open={batchSenderPickerOpen}
        wallets={wallets}
        onConfirm={(addrs) => { setBatchSenders(addrs); setBatchSenderPickerOpen(false) }}
        onCancel={() => setBatchSenderPickerOpen(false)}
        title="批量选择发送方（支持全选/反选）"
      />
      <WalletPickerModal
        open={batchRecipientPickerOpen}
        wallets={wallets}
        onConfirm={(addrs) => { setBatchRecipients(addrs); setBatchRecipientPickerOpen(false) }}
        onCancel={() => setBatchRecipientPickerOpen(false)}
        title="批量选择接收方（支持全选/反选）"
      />
    </div>
  )
}

export default ManyToMany
