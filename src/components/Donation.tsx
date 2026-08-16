import React from 'react'
import {
  Alert,
  App as AntApp,
  Button,
  Card,
  Input,
  QRCode,
  Space,
  Tag,
  Typography,
} from 'antd'
import { CopyOutlined, HeartFilled } from '@ant-design/icons'

const { Title, Paragraph, Text } = Typography

export const EVM_DONATION_ADDRESS = '0xd439325794932c3ccd45affa85effe5363af1ca8'

const DonationContent: React.FC = () => {
  const { message } = AntApp.useApp()

  const copyAddress = async () => {
    try {
      await navigator.clipboard.writeText(EVM_DONATION_ADDRESS)
      message.success('捐赠地址已复制')
    } catch {
      message.error('复制失败，请手动选择地址复制')
    }
  }

  return (
    <Card className="donation-card" variant="borderless">
      <Space orientation="vertical" align="center" size="large" style={{ width: '100%' }}>
        <HeartFilled className="donation-heart" />
        <div style={{ textAlign: 'center' }}>
          <Title level={2} style={{ marginBottom: 8 }}>支持这个项目</Title>
          <Paragraph type="secondary" style={{ maxWidth: 560, marginBottom: 0 }}>
            如果这个工具对你有帮助，欢迎通过 EVM 网络捐赠。你的支持会用于持续维护和改进项目。
          </Paragraph>
        </div>

        <Tag color="purple" style={{ fontSize: 14, padding: '4px 12px' }}>EVM 地址</Tag>

        <div className="donation-qr" role="img" aria-label="EVM 捐赠地址二维码">
          <QRCode
            value={EVM_DONATION_ADDRESS}
            type="svg"
            size={240}
            errorLevel="M"
            bordered={false}
          />
        </div>

        <div className="donation-address-block">
          <Text strong>捐赠地址</Text>
          <Space.Compact block>
            <Input
              value={EVM_DONATION_ADDRESS}
              readOnly
              size="large"
              className="donation-address-input"
            />
            <Button size="large" icon={<CopyOutlined />} onClick={copyAddress}>
                复制地址
            </Button>
          </Space.Compact>
        </div>

        <Alert
          type="warning"
          showIcon
          style={{ width: '100%', maxWidth: 640 }}
          title="请使用兼容 EVM 的网络"
          description="转账前请核对钱包中的网络、代币和地址。请勿向此地址发送 Solana 网络资产。"
        />
      </Space>
    </Card>
  )
}

const Donation: React.FC = () => (
  <AntApp>
    <DonationContent />
  </AntApp>
)

export default Donation
