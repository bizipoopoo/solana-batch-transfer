import React, { useState, useRef, useCallback } from 'react'
import {
  Button,
  Table,
  Tag,
  Space,
  message,
  Typography,
  Tooltip,
  Alert,
  Progress,
  InputNumber,
} from 'antd'
import {
  PlayCircleOutlined,
  TeamOutlined,
  ClearOutlined,
  ArrowRightOutlined,
  CheckCircleOutlined,
} from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import type { TransferConfig, TransferStatus, ManagedWallet } from '../types'
import {
  getConnection,
  keypairFromPrivateKey,
  getExplorerUrl,
  shortenAddress,
  getSOLBalance,
  sweepWalletToNext,
} from '../services/solana'
import WalletPickerModal from './WalletPickerModal'
import { PublicKey } from '@solana/web3.js'

const { Text, Link } = Typography
const RETRY_DELAY_MS = 1500

interface RecoveryStep {
  key: string
  index: number
  fromAddress: string
  toAddress: string
  status: TransferStatus
  txHashes?: string[]
  error?: string
  solBefore?: number
  solAfter?: number
  closedTokenAccounts?: number
  transferredTokenAccounts?: number
  transferredSOL?: number
}

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

const FundRecovery: React.FC<Props> = ({ config, wallets }) => {
  const [selectedAddresses, setSelectedAddresses] = useState<string[]>([])
  const [steps, setSteps] = useState<RecoveryStep[]>([])
  const [executing, setExecuting] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [currentStep, setCurrentStep] = useState(-1)
  const [maxRetries, setMaxRetries] = useState(3)
  const cancelRef = useRef(false)

  const buildSteps = useCallback((addresses: string[]) => {
    if (addresses.length < 2) {
      setSteps([])
      return
    }
    const newSteps: RecoveryStep[] = []
    for (let i = 0; i < addresses.length - 1; i++) {
      newSteps.push({
        key: `${i}`,
        index: i,
        fromAddress: addresses[i],
        toAddress: addresses[i + 1],
        status: 'pending',
      })
    }
    setSteps(newSteps)
  }, [])

  const handlePickerConfirm = (addresses: string[]) => {
    if (addresses.length < 2) {
      message.warning('至少需要选择 2 个钱包才能进行链式回收')
      return
    }
    setSelectedAddresses(addresses)
    buildSteps(addresses)
    setPickerOpen(false)
    message.success(`已选择 ${addresses.length} 个钱包，将生成 ${addresses.length - 1} 步回收链`)
  }

  const execute = async () => {
    if (steps.length === 0) return message.warning('请先选择钱包')

    setExecuting(true)
    cancelRef.current = false

    const connection = getConnection(config.network, config.rpcUrl)

    for (let i = 0; i < steps.length; i++) {
      if (cancelRef.current) break
      const step = steps[i]
      if (step.status === 'success') continue

      setCurrentStep(i)

      const fromWallet = wallets.find((w) => w.address === step.fromAddress)
      if (!fromWallet) {
        setSteps((p) => p.map((s, idx) => (idx === i ? { ...s, status: 'failed', error: '钱包未找到' } : s)))
        continue
      }

      setSteps((p) => p.map((s, idx) => (idx === i ? { ...s, status: 'processing', error: undefined } : s)))

      let finished = false
      for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
        try {
          const sender = keypairFromPrivateKey(fromWallet.privateKey)
          const recipientPk = new PublicKey(step.toAddress)
          const solBefore = await getSOLBalance(connection, sender.publicKey)
          const result = await sweepWalletToNext(connection, sender, recipientPk)
          const solAfter = await getSOLBalance(connection, recipientPk)

          setSteps((p) => p.map((s, idx) =>
            idx === i
              ? {
                  ...s,
                  status: 'success',
                  txHashes: result.txHashes,
                  solBefore,
                  solAfter,
                  closedTokenAccounts: result.closedTokenAccounts,
                  transferredTokenAccounts: result.transferredTokenAccounts,
                  transferredSOL: result.transferredSOL,
                  error: attempt > 1 ? `第 ${attempt} 次尝试成功` : undefined,
                }
              : s,
          ))
          finished = true
          break
        } catch (err: any) {
          const errorMessage = err?.message || '未知错误'
          const hasRetryLeft = attempt <= maxRetries && !cancelRef.current

          if (hasRetryLeft) {
            setSteps((p) => p.map((s, idx) =>
              idx === i
                ? {
                    ...s,
                    status: 'processing',
                    error: `第 ${attempt} 次失败：${errorMessage}，${RETRY_DELAY_MS / 1000} 秒后自动重试`,
                  }
                : s,
            ))
            await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS))
            continue
          }

          setSteps((p) => p.map((s, idx) =>
            idx === i
              ? {
                  ...s,
                  status: 'failed',
                  error:
                    maxRetries > 0
                      ? `已重试 ${maxRetries} 次仍失败：${errorMessage}`
                      : errorMessage,
                }
              : s,
          ))
          break
        }
      }

      if (!finished) {
        break
      }
    }

    setCurrentStep(-1)
    setExecuting(false)
    message.success('回收流程执行完毕')
  }

  const handleClear = () => {
    setSelectedAddresses([])
    setSteps([])
    setCurrentStep(-1)
  }

  const handleRetryFromFailed = () => {
    setSteps((p) => p.map((s) =>
      s.status === 'failed' ? { ...s, status: 'pending', error: undefined } : s,
    ))
  }

  const columns: ColumnsType<RecoveryStep> = [
    {
      title: '步骤', width: 70,
      render: (_, __, idx) => <Tag>{idx + 1} / {steps.length}</Tag>,
    },
    {
      title: '从', dataIndex: 'fromAddress', width: 190,
      render: (addr: string) => (
        <Tooltip title={addr}>
          <Text copyable={{ text: addr }} style={{ fontFamily: 'monospace', fontSize: 12 }}>
            {shortenAddress(addr, 6)}
          </Text>
        </Tooltip>
      ),
    },
    {
      title: '', width: 30, align: 'center',
      render: () => <ArrowRightOutlined style={{ color: '#999' }} />,
    },
    {
      title: '到', dataIndex: 'toAddress', width: 190,
      render: (addr: string) => (
        <Tooltip title={addr}>
          <Text copyable={{ text: addr }} style={{ fontFamily: 'monospace', fontSize: 12 }}>
            {shortenAddress(addr, 6)}
          </Text>
        </Tooltip>
      ),
    },
    {
      title: '回收结果', width: 220,
      render: (_: unknown, record: RecoveryStep) => (
        <Space direction="vertical" size={0}>
          <Text style={{ fontFamily: 'monospace', fontSize: 12 }}>
            关闭账户: {record.closedTokenAccounts ?? 0}
          </Text>
          <Text style={{ fontFamily: 'monospace', fontSize: 12 }}>
            转移代币账户: {record.transferredTokenAccounts ?? 0}
          </Text>
          <Text style={{ fontFamily: 'monospace', fontSize: 12 }}>
            转出 SOL: {(record.transferredSOL ?? 0).toFixed(6)}
          </Text>
        </Space>
      ),
    },
    {
      title: '执行前 SOL', dataIndex: 'solBefore', width: 130,
      render: (v?: number) =>
        v != null
          ? <Text style={{ fontFamily: 'monospace' }}>{v.toFixed(6)} SOL</Text>
          : <Text type="secondary">--</Text>,
    },
    {
      title: '状态', dataIndex: 'status', width: 100,
      render: (s: TransferStatus) => <Tag color={STATUS_MAP[s].color}>{STATUS_MAP[s].text}</Tag>,
    },
    {
      title: '交易', width: 180,
      render: (_: unknown, record: RecoveryStep) =>
        record.txHashes && record.txHashes.length > 0 ? (
          <Space direction="vertical" size={0}>
            {record.txHashes.slice(0, 3).map((hash) => (
              <Link
                key={hash}
                href={getExplorerUrl(hash, config.network)}
                target="_blank"
                style={{ fontFamily: 'monospace', fontSize: 12 }}
              >
                {shortenAddress(hash, 8)}
              </Link>
            ))}
            {record.txHashes.length > 3 && (
              <Text type="secondary" style={{ fontSize: 12 }}>
                还有 {record.txHashes.length - 3} 笔
              </Text>
            )}
          </Space>
        ) : '-',
    },
    {
      title: '错误', dataIndex: 'error', ellipsis: true,
      render: (err: string) => err ? <Text type="danger" ellipsis={{ tooltip: err }}>{err}</Text> : '-',
    },
  ]

  const successCount = steps.filter((s) => s.status === 'success').length
  const failedCount = steps.filter((s) => s.status === 'failed').length
  const progressPercent = steps.length > 0 ? Math.round((successCount / steps.length) * 100) : 0

  const lastWallet = selectedAddresses.length > 0 ? selectedAddresses[selectedAddresses.length - 1] : null
  const lastSuccessStep = [...steps].reverse().find((s) => s.status === 'success')

  return (
    <div className="transfer-card">
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="资金回收模式"
        description={
          <span>
            选择一组钱包后，系统会从第 1 个钱包开始，依次扫描当前钱包下的全部 SPL 账户。
            空账户会直接关闭回收租金；有余额的账户会先把代币转到下一个钱包，再关闭账户回收租金；
            最后把当前钱包剩余的 SOL 也转给下一个钱包。这样资金会像滚雪球一样逐级归集，
            最终汇聚到<strong>最后一个钱包</strong>中。请确保第 1 个钱包有基础 SOL 用于启动整个回收链。
          </span>
        }
      />

      <Space wrap style={{ marginBottom: 16 }}>
        <Button type="primary" icon={<TeamOutlined />} onClick={() => setPickerOpen(true)} disabled={executing}>
          选择回收钱包链
        </Button>
        <Space size={4}>
          <Text type="secondary">自动重试:</Text>
          <InputNumber
            min={0}
            max={10}
            value={maxRetries}
            onChange={(v) => setMaxRetries(v ?? 3)}
            disabled={executing}
            size="small"
            style={{ width: 72 }}
          />
          <Text type="secondary">次</Text>
        </Space>
        {selectedAddresses.length > 0 && (
          <>
            <Tag color="blue">{selectedAddresses.length} 个钱包 / {steps.length} 步</Tag>
            {lastWallet && (
              <Tooltip title={lastWallet}>
                <Tag color="green" icon={<CheckCircleOutlined />}>
                  最终归集到: {shortenAddress(lastWallet, 8)}
                </Tag>
              </Tooltip>
            )}
          </>
        )}
      </Space>

      {selectedAddresses.length > 0 && selectedAddresses.length < 2 && (
        <Alert type="warning" message="至少需要 2 个钱包才能形成回收链" showIcon style={{ marginBottom: 16 }} />
      )}

      {steps.length > 0 && (
        <>
          {executing && (
            <Progress
              percent={progressPercent}
              status="active"
              format={() => `${successCount} / ${steps.length}`}
              style={{ marginBottom: 12 }}
            />
          )}

          {!executing && successCount === steps.length && steps.length > 0 && (
            <Alert
              type="success"
              showIcon
              style={{ marginBottom: 16 }}
              message={
                <span>
                  全部回收完毕！所有资金已归集到最后一个钱包
                  {lastWallet && (
                    <Text copyable={{ text: lastWallet }} style={{ fontFamily: 'monospace', marginLeft: 8 }}>
                      {shortenAddress(lastWallet, 10)}
                    </Text>
                  )}
                  {lastSuccessStep?.solAfter != null && (
                    <Tag color="green" style={{ marginLeft: 8 }}>
                      当前 SOL: {lastSuccessStep.solAfter.toFixed(6)}
                    </Tag>
                  )}
                </span>
              }
            />
          )}

          <Alert type="info" showIcon style={{ marginBottom: 16 }} message={
            <Space split="|">
              <span>共 {steps.length} 步</span>
              <span>自动重试: {maxRetries} 次</span>
              {successCount > 0 && <span style={{ color: '#52c41a' }}>完成: {successCount}</span>}
              {failedCount > 0 && <span style={{ color: '#ff4d4f' }}>失败: {failedCount}</span>}
              {executing && currentStep >= 0 && <span style={{ color: '#1890ff' }}>正在执行第 {currentStep + 1} 步</span>}
            </Space>
          } />

          <Table
            columns={columns}
            dataSource={steps}
            pagination={false}
            size="small"
            scroll={{ y: 400 }}
            style={{ marginBottom: 16 }}
            rowClassName={(record) => record.status === 'processing' ? 'row-processing' : ''}
          />

          <Space>
            {executing ? (
              <Button danger onClick={() => (cancelRef.current = true)}>停止执行</Button>
            ) : (
              <Button type="primary" icon={<PlayCircleOutlined />} onClick={execute} size="large">
                开始回收
              </Button>
            )}
            {failedCount > 0 && !executing && (
              <Button onClick={handleRetryFromFailed}>从失败处重试</Button>
            )}
            <Button icon={<ClearOutlined />} onClick={handleClear} disabled={executing}>清空</Button>
          </Space>
        </>
      )}

      <WalletPickerModal
        open={pickerOpen}
        wallets={wallets}
        onConfirm={handlePickerConfirm}
        onCancel={() => setPickerOpen(false)}
        title="选择回收钱包链（按选择顺序依次回收，资金最终留在最后一个）"
      />
    </div>
  )
}

export default FundRecovery
