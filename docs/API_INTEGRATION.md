# 晴天支付中心业务网站接入

生产 API：`https://pay-api.lynli.me`

每个业务网站在管理面板「业务网站」中单独登记，再为该站点创建独立 API Key。API Key 只在创建时显示一次，服务端只保存 SHA-256 摘要。不同站点的商品、订单、支付记录和交付任务按 `site_id` 隔离。

## 创建支付订单

请求：

```http
POST /api/v1/payments
Authorization: Bearer <该站点的 API Key>
Content-Type: application/json
```

```json
{
  "product_id": "管理面板中创建的商品 ID",
  "external_order_no": "业务网站自己的唯一订单号",
  "payment_method": "alipay_jsapi",
  "buyer_ref": "业务网站内部用户标识",
  "buyer_email": "可选的买家邮箱",
  "metadata": { "source": "website" }
}
```

商品价格从支付中心商品目录读取，客户端不能传入或覆盖应收金额。`external_order_no` 在同一站点内必须唯一。买家身份由支付中心在用户使用支付宝扫码后，通过支付宝 OAuth auth_base 授权流程取得，不需要业务网站传入 buyer_id。

成功响应示例：

```json
{
  "order_no": "QT...",
  "status": "pending",
  "payment_method": "alipay_jsapi",
  "checkout_url": "https://pay-api.lynli.me/api/checkout/<一次性令牌>",
  "qr_image_url": "https://pay-api.lynli.me/api/qr?...",
  "expires_in": 900
}
```

支付中心为每笔订单创建 15 分钟有效的一次性 checkout token，并返回订单专属二维码。付款人必须使用支付宝 App 扫描二维码；支付中心将其导向支付宝 auth_base 授权，服务端通过 alipay.system.oauth.token 换取真实 user_id，随后调用 alipay.trade.create 创建 JSAPI 交易，并跳转到支付页面调用 AlipayJSBridge 的 tradePay（传入 tradeNO）。普通浏览器没有支付宝 JSAPI Bridge，不能直接完成该支付流程。当前接口拒绝 alipay_page 和 alipay_wap，不会回退到手机网站支付或电脑网站支付。只有服务端验签通过的异步通知，或通过签名验证的支付宝交易查询，才能把订单标记为已支付。

## 查询订单

```http
GET /api/v1/orders/{order_no}
Authorization: Bearer <该站点的 API Key>
```

只允许查询当前 API Key 所属站点的订单。待支付订单会尝试向支付宝查询并进行服务端状态补偿；商户 PID 未配置时不会执行该补偿。

## Webhook 自动交付

在「业务网站」创建站点时选择「Webhook 自动交付」，填写 HTTPS 接收地址。创建成功后，管理面板会显示该站点独立的 Webhook 签名密钥；请将它保存到对应业务网站的服务端环境变量，不要放到浏览器代码中。

支付成功后，支付中心向该地址发送 `order.paid` JSON，附带：

- `x-qingtian-event: order.paid`
- `x-qingtian-signature: <HMAC-SHA256 十六进制签名>`
- `idempotency-key: delivery:<内部订单 ID>`

接收端应对**原始请求 body 字节**使用该站点的签名密钥计算 HMAC-SHA256，并以常量时间比较签名；成功处理后返回 2xx。请按 `idempotency_key` 做幂等处理，避免重试导致重复发货。支付中心会记录每次交付状态，失败任务可在管理面板重试。

## 上线前置条件

- 完成首次超级管理员初始化。
- 在服务器配置正确的支付宝商户 PID（seller_id），与 AppID、应用私钥和支付宝公钥匹配。
- 用真实支付宝账号完成 JSAPI 支付、异步通知验签、主动查询补偿、退款查询和自动交付的端到端验收。

在以上条件完成前，支付中心不会开放新支付订单。
