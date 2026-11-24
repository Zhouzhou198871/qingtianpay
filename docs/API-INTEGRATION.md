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
  "buyer_id": "通过支付宝授权流程取得的当前用户 user_id",
  "buyer_ref": "业务网站内部用户标识",
  "buyer_email": "可选的买家邮箱",
  "metadata": { "source": "website" }
}
```

商品价格从支付中心商品目录读取，客户端不能传入或覆盖应收金额。`external_order_no` 在同一站点内必须唯一。`buyer_id` 是支付宝 JSAPI 所需的买家 user_id，不是业务网站内部用户 ID。

成功响应示例：

```json
{
  "order_no": "QT...",
  "status": "pending",
  "payment_method": "alipay_jsapi",
  "invoke": { "tradeNO": "支付宝创建的交易号" }
}
```

支付中心只调用 `alipay.trade.create` 创建 JSAPI 交易，并返回 `invoke.tradeNO`；业务网站前端必须运行在支付宝支持的 JSAPI 容器内，通过支付宝 JSAPI 的 `tradePay` 能力调起支付。业务网站须先完成支付宝用户授权并取得当前用户的 `user_id`，将其从业务网站服务端传给支付中心；不能把业务网站自己的用户 ID 当作 `buyer_id`。当前接口拒绝 `alipay_page` 和 `alipay_wap`，不会回退到手机网站支付或电脑网站支付。只有服务端验签通过的异步通知，或通过签名验证的支付宝交易查询，才能把订单标记为已支付。

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
