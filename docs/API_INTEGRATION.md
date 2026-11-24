# 晴天支付中心 API 接入说明

## 基本信息

- API 基础地址：`https://pay.lynli.me`
- 币种：CNY
- 支付渠道：支付宝 JSAPI
- 订单支付状态以服务端异步通知及主动查询为准，不能以客户端支付回调直接发货。

## 业务网站接入

在支付中心后台创建业务网站，并为该网站生成独立 API Key。API Key 只展示一次，业务网站应保存在自己的服务端环境变量中，禁止放在浏览器代码、公开仓库或客户端安装包内。

### 创建支付订单

`POST /api/v1/payments`

请求头：

```http
Authorization: Bearer <SITE_API_KEY>
Content-Type: application/json
```

请求体：

```json
{
  "product_id": "<支付中心商品ID>",
  "external_order_no": "SHOP-ORDER-20261124-0001",
  "buyer_id": "<支付宝授权取得的 buyer_id>",
  "buyer_ref": "业务网站内部用户编号",
  "buyer_email": "buyer@example.com",
  "metadata": {
    "source": "shop-web"
  }
}
```

注意：
- 金额和商品名称由支付中心根据 `product_id` 从数据库读取，不能信任业务网站客户端提交的金额。
- `external_order_no` 在同一业务网站内必须唯一。
- JSAPI 需要支付宝授权上下文中的 `buyer_id`。普通浏览器中的任意用户编号不能代替支付宝 buyer_id。
- 创建成功返回支付中心订单号和支付宝 `trade_no`。

成功响应示例：

```json
{
  "order_no": "QT...",
  "trade_no": "支付宝交易号",
  "status": "pending",
  "payment_method": "alipay_jsapi",
  "invoke": {
    "tradeNO": "支付宝交易号"
  }
}
```

在支付宝小程序客户端中，使用返回的交易号调用：

```javascript
my.tradePay({
  tradeNO: result.trade_no,
  success: function (res) {
    // 仅用于展示支付流程结果；不要在这里直接发货
  },
  fail: function (err) {
    // 展示取消或失败提示
  }
});
```

### 查询订单

`GET /api/v1/orders/{order_no}`

同样使用业务网站的 Bearer API Key。接口只返回该 API Key 所属网站的订单，不允许跨站点读取。对于仍处于 pending 的订单，支付中心会尝试调用支付宝 `alipay.trade.query` 做服务端补偿核对，再返回最新状态。

## 支付宝异步通知

服务端创建交易时会将以下地址传给支付宝：

`https://pay.lynli.me/api/alipay/notify`

支付中心将验签、核对 AppID、商户订单号和金额，并在交易状态为 `TRADE_SUCCESS` 或 `TRADE_FINISHED` 时幂等更新订单，再触发交付。支付宝通知必须返回纯文本 `success`；验签或订单核对失败返回 `failure`。

客户端 `my.tradePay` 回调不是付款凭证。若通知延迟，应由业务服务端查询支付中心订单状态。

## 自动交付

每个业务网站可配置交付模式：
- `manual`：建立待处理交付记录，由后台人工完成。
- `webhook`：支付中心向该网站配置的 HTTPS 交付地址发送 `order.paid` 事件。
- `internal`：预留给支付中心内部交付类型。

Webhook 请求头：
- `x-qingtian-event: order.paid`
- `x-qingtian-signature: <HMAC-SHA256 hex>`
- `idempotency-key: delivery:<支付中心订单ID>`

Webhook 请求体包含订单号、商品 ID、站点 ID、金额（分）、币种、付款时间和幂等键。接收端必须校验签名，并以幂等键防止重复发货。交付失败会保留失败记录，可在后台重试。

## 管理接口

管理后台使用 HttpOnly 会话 Cookie。当前已提供：
- `GET /api/health`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/me`
- `GET,POST /api/sites`
- `GET,POST /api/products`
- `POST /api/sites/{site_id}/api-keys`
- `GET /api/sites/{site_id}/api-keys`
- `GET /api/api-keys`
- `POST /api/api-keys/{id}/revoke`
- `GET /api/orders`
- `GET /api/payments`
- `GET,POST /api/refunds`
- `GET /api/deliveries`
- `POST /api/deliveries/{id}/retry`
- `GET,POST /api/admins`
- `PATCH /api/admins/{id}`
- `POST /api/auth/change-password`
- `GET /api/audit-logs`
- `GET /api/analytics/revenue`
- `GET /api/ledger`

## 尚待配置的密钥

以下仅允许放入 Cloudflare Worker Secrets，不得提交 Git：
- `ALIPAY_PRIVATE_KEY`：与支付宝后台已上传应用公钥配对的应用私钥（PKCS#8 PEM）。
- `ALIPAY_PUBLIC_KEY`：支付宝开放平台提供的支付宝公钥（Base64 或 SPKI PEM）。
- `BOOTSTRAP_SECRET`：一次性初始化超级管理员密码的随机口令。
- `DELIVERY_SIGNING_SECRET`：支付中心签署业务网站交付 Webhook 的随机密钥。

当前支付 API 代码已部署，但在应用私钥和上述必要 Secret 配置并通过真实支付宝联调前，不得用于真实收款。
