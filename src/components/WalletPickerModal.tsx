import React, { useState, useMemo } from 'react'
import { Modal, Table, Button, Space, Input, Tag, Typography, Checkbox } from 'antd'
import {
  CheckSquareOutlined,
  SwapOutlined,
  ClearOutlined,
  SearchOutlined,
} from '@ant-design/icons'
import type { ManagedWallet } from '../types'
import { shortenAddress } from '../services/solana'

interface Props {
  open: boolean
  wallets: ManagedWallet[]
  onConfirm: (addresses: string[]) => void
  onCancel: () => void
  title?: string
  excludeAddresses?: string[]
}

const WalletPickerModal: React.FC<Props> = ({
  open,
  wallets,
  onConfirm,
  onCancel,
  title = '从钱包选择地址',
  excludeAddresses = [],
}) => {
  const [selectedKeys, setSelectedKeys] = useState<string[]>([])
  const [search, setSearch] = useState('')

  const excludeSet = useMemo(() => new Set(excludeAddresses), [excludeAddresses])

  const filteredWallets = useMemo(() => {
    let list = wallets.filter((w) => !excludeSet.has(w.address))
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      list = list.filter(
        (w) =>
          w.address.toLowerCase().includes(q) ||
          w.groupName.toLowerCase().includes(q) ||
          (w.derivationIndex != null && String(w.derivationIndex).includes(q)),
      )
    }
    return list
  }, [wallets, excludeSet, search])

  const allFilteredKeys = filteredWallets.map((w) => w.address)

  const handleSelectAll = () => {
    setSelectedKeys(allFilteredKeys)
  }

  const handleInvert = () => {
    const currentSet = new Set(selectedKeys)
    setSelectedKeys(allFilteredKeys.filter((k) => !currentSet.has(k)))
  }

  const handleClear = () => {
    setSelectedKeys([])
  }

  const handleOk = () => {
    onConfirm(selectedKeys)
    setSelectedKeys([])
    setSearch('')
  }

  const handleCancel = () => {
    onCancel()
    setSelectedKeys([])
    setSearch('')
  }

  const allChecked = allFilteredKeys.length > 0 && selectedKeys.length === allFilteredKeys.length
  const indeterminate = selectedKeys.length > 0 && selectedKeys.length < allFilteredKeys.length

  const selectedWallets = filteredWallets.filter((w) => selectedKeys.includes(w.address))
  const selectedSOL = selectedWallets.reduce((s, w) => s + (w.solBalance ?? 0), 0)
  const selectedToken = selectedWallets.reduce((s, w) => s + (w.tokenBalance ?? 0), 0)
  const hasBalances = selectedWallets.some((w) => w.solBalance != null)

  return (
    <Modal
      title={title}
      open={open}
      onOk={handleOk}
      onCancel={handleCancel}
      okText={`确定 (${selectedKeys.length})`}
      cancelText="取消"
      width={640}
      okButtonProps={{ disabled: selectedKeys.length === 0 }}
      destroyOnClose
    >
      <Space direction="vertical" style={{ width: '100%' }} size="middle">
        <Space wrap>
          <Input
            placeholder="搜索地址 / 组名 / 序号"
            prefix={<SearchOutlined />}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            allowClear
            style={{ width: 240 }}
          />
          <Button icon={<CheckSquareOutlined />} onClick={handleSelectAll}>
            全选
          </Button>
          <Button icon={<SwapOutlined />} onClick={handleInvert}>
            反选
          </Button>
          <Button icon={<ClearOutlined />} onClick={handleClear}>
            清空
          </Button>
          <Tag color="blue">{selectedKeys.length} / {filteredWallets.length} 已选</Tag>
          {hasBalances && selectedKeys.length > 0 && (
            <Tag color="green">合计: {selectedSOL.toFixed(4)} SOL</Tag>
          )}
          {selectedToken > 0 && (
            <Tag color="purple">代币合计: {selectedToken.toFixed(4)}</Tag>
          )}
        </Space>
        <Table
          size="small"
          pagination={false}
          scroll={{ y: 360 }}
          dataSource={filteredWallets}
          rowKey="address"
          rowSelection={{
            selectedRowKeys: selectedKeys,
            onChange: (keys) => setSelectedKeys(keys as string[]),
            columnTitle: (
              <Checkbox
                checked={allChecked}
                indeterminate={indeterminate}
                onChange={(e) => (e.target.checked ? handleSelectAll() : handleClear())}
              />
            ),
          }}
          columns={[
            {
              title: '组',
              dataIndex: 'groupName',
              width: 120,
              render: (name: string) => <Tag>{name}</Tag>,
            },
            {
              title: '#',
              dataIndex: 'derivationIndex',
              width: 60,
              render: (index?: number) => index ?? '私钥',
            },
            {
              title: '地址',
              dataIndex: 'address',
              render: (addr: string) => (
                <Typography.Text style={{ fontFamily: 'monospace', fontSize: 12 }}>
                  {shortenAddress(addr, 10)}
                </Typography.Text>
              ),
            },
            {
              title: 'SOL',
              dataIndex: 'solBalance',
              width: 100,
              render: (v?: number) =>
                v != null ? (
                  <Typography.Text style={{ fontFamily: 'monospace', fontSize: 12 }}>
                    {v.toFixed(4)}
                  </Typography.Text>
                ) : (
                  <Typography.Text type="secondary">--</Typography.Text>
                ),
            },
          ]}
        />
      </Space>
    </Modal>
  )
}

export default WalletPickerModal
