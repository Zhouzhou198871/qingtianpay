# 晴天支付中心业务网站接入

生产 API：`https://pay-api.lynli.me`

每个业务网站在管理面板「业务网站」中单独登记，再为该站点创建独立 API Key。API Key 只在创建时显示一次，服务端只保存 SHA-256 摘要。不同站点的订单、支付记录和交付任务按 `site_id` 隔离。

## 创建支付订单

请求：

```http
POST /api/v1/payments
Authorization: Bearer <该站点的 API Key>
Content-Type: application/json
```

**推荐：商品由业务网站自己管理，支付中心不要求先建商品。** 用户在业务网站选择商品并创建订单后，业务网站服务端把实际订单金额、商品名称和业务订单号传给支付中心：

```json
{
  "external_order_no": "SHOP-20261124-10001",
  "subject": "商品名称",
  "amount_minor": 2990,
  "currency": "CNY",
  "payment_method": "alipay_jsapi",
  "buyer_ref": "业务网站内部用户标识",
  "buyer_email": "可选的买家邮箱",
  "metadata": {
    "product_id": "业务网站自己的商品ID",
    "delivery_ref": "业务网站自己的交付记录标识"
  }
}
```

`amount_minor` 使用人民币分，例如 2990 表示 ¥29.90。也可传 `amount: 29.90`（元），二者选其一。必须传 `external_order_no`、`subject` 和金额。支付中心按本次订单金额创建独立订单和专属二维码，返回 `checkout_url`、`qr_image_url`。每个站点的 `external_order_no` 必须唯一。金额应由业务网站服务端从自己的订单记录读取，不能直接信任浏览器提交的金额。

商品目录仍可选用：如果传入 `product_id`，支付中心会校验该商品属于当前站点且处于启用状态，并以商品目录价格为准；不传 `product_id` 时完全不查询支付中心商品目录。

成功响应示例：

```json
{
  "order_no": "QT...",
  "external_order_no": "SHOP-20261124-10001",
  "subject": "商品名称",
  "amount_minor": 2990,
  "currency": "CNY",
  "status": "pending",
  "payment_method": "alipay_jsapi",
  "checkout_url": "https://pay-api.lynli.me/api/checkout/<一次性令牌>",
  "qr_image_url": "https://pay-api.lynli.me/api/qr?...",
  "expires_in": 900
}
```

付款人使用支付宝 App 扫描该笔订单的二维码。支付中心将其导向支付宝 auth_base 授权，服务端通过 `alipay.system.oauth.token` 换取真实支付宝 user_id，随后调用 `alipay.trade.create` 创建 JSAPI 交易，并跳转到支付页面调用 AlipayJSBridge 的 `tradePay`（传入 `tradeNO`）。普通浏览器没有支付宝 JSAPI Bridge，不能直接完成该支付流程。当前接口只走已配置的支付宝 JSAPI 流程，不会回退到手机网站支付、当面付或电脑网站支付。

## 查询订单

```http
GET /api/v1/orders/{order_no}
Authorization: Bearer <该站点的 API Key>
```

只允许查询当前 API Key 所属站点的订单。待支付订单会尝试向支付宝查询并进行服务端状态补偿。只有服务端验签通过的异步通知，或通过签名验证且金额、卖家匹配的支付宝交易查询，才能把订单标记为已支付。

## Webhook 自动交付

在「业务网站」创建站点时选择「Webhook 自动交付」，填写 HTTPS 接收地址。创建成功后，管理面板会显示该站点独立的 Webhook 签名密钥；请将它保存到对应业务网站的服务端环境变量，不要放到浏览器代码中。

支付成功后，支付中心向该地址发送 `order.paid` JSON，包含业务订单号、商品名称（无支付中心商品时使用订单标题）、金额、站点 ID 和支付时间，并附带：

- `x-qingtian-event: order.paid`
- `x-qingtian-signature: <HMAC-SHA256 十六进制签名>`
- `idempotency-key: delivery:<内部订单 ID>`

接收端应对**原始请求 body 字节**使用该站点的签名密钥计算 HMAC-SHA256，并以常量时间比较签名；成功处理后返回 2xx。请按 `idempotency_key` 做幂等处理，避免重试导致重复发货。支付中心会记录每次交付状态，失败任务可在管理面板重试。

## 上线验收

- 完成首次超级管理员初始化。
- 业务网站已登记并配置独立 API Key、Webhook 地址和交付密钥。
- 在支付宝支持的容器中完成真实 JSAPI 授权和支付。
- 验证异步通知验签、订单金额核对、订单查询补偿和自动交付。
- 真实退款和退款查询需单独验证支付宝权限后再启用。
