# Solana 批量转账

一个面向 Solana 的批量转账桌面应用，支持 SOL 和 SPL 代币的一对多、多对多、多对一转账及资金回收。

## 功能

- 导入助记词并批量派生钱包
- 批量导入 Base58 或 JSON 数组格式的私钥
- SOL 与 SPL 代币批量转账
- 链式资金回收、代币卖出、销毁及账户租金回收
- 自动跳过冻结代币账户和无法执行的极小余额钱包
- Devnet、Testnet、Mainnet 及自定义 RPC

## 下载

请前往 [GitHub Releases](https://github.com/bizipoopoo/solana-batch-transfer/releases) 下载适用于 macOS 或 Windows 的最新安装包。

## 本地开发

```bash
npm install
npm run dev
```

构建前端或桌面安装包：

```bash
npm run build
npm run build:mac
npm run build:win
```

## 安全说明

助记词和私钥仅保存在应用运行时内存中，关闭应用后会清除，不会持久化保存。使用主网资产前，请先用小额资产测试完整流程。

## 捐赠

如果这个项目对你有帮助，欢迎通过 EVM 网络支持项目的持续维护。

![EVM 捐赠地址二维码](docs/donation-evm-qr.svg)

EVM 地址：

```text
0xd439325794932c3ccd45affa85effe5363af1ca8
```

> 请使用兼容 EVM 的网络，并在转账前核对网络、代币和地址。请勿向此地址发送 Solana 网络资产。
