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
  "metadata": {"product_id": "业务网站自己的商品ID"}
}
```

`amount_minor` 使用人民币分，例如 2990 表示 ¥29.90。也可传 `amount: 29.90`（元），二者选其一。必须传 `external_order_no`、`subject` 和金额。金额应由业务网站服务端从自己的订单记录读取，不能直接信任浏览器提交的金额。支付中心按本次订单金额创建独立订单和专属二维码，并返回 `checkout_url`、`qr_image_url`。

商品目录仍可选用：如果传入 `product_id`，支付中心会校验该商品属于当前站点且处于启用状态，并以商品目录价格为准；不传 `product_id` 时完全不查询支付中心商品目录。

成功响应包含 `order_no`、`amount_minor`、`checkout_url`、`qr_image_url` 和 900 秒有效期。付款人使用支付宝 App 扫描该笔订单二维码。支付中心通过支付宝 auth_base 授权取得真实支付宝 user_id，调用 `alipay.trade.create` 创建 JSAPI 交易，再跳转到支付页调用 AlipayJSBridge `tradePay`（传入 `tradeNO`）。普通浏览器没有支付宝 JSAPI Bridge，不能直接完成该支付流程。当前只走支付宝 JSAPI，不会回退到手机网站支付或当面付。

## 查询订单

```http
GET /api/v1/orders/{order_no}
Authorization: Bearer <该站点的 API Key>
```

只允许查询当前 API Key 所属站点的订单。只有服务端验签通过的异步通知，或金额、卖家匹配的签名验证支付宝查询，才能把订单标记为已支付。

## Webhook 自动交付

在「业务网站」创建站点时选择「Webhook 自动交付」，填写 HTTPS 接收地址。支付成功后，支付中心发送 `order.paid` JSON，包含业务订单号、商品名称（未关联支付中心商品时使用订单标题）、金额、站点 ID 和支付时间，并附带 `x-qingtian-event`、`x-qingtian-signature`、`idempotency-key`。接收端应对原始请求 body 使用该站点签名密钥计算 HMAC-SHA256，常量时间比较签名并按幂等键避免重复发货。失败任务可在管理面板重试。

## 上线验收

- 完成首次超级管理员初始化。
- 业务网站已登记并配置独立 API Key、Webhook 地址和交付密钥。
- 在支付宝支持的容器中完成真实 JSAPI 授权和支付。
- 验证异步通知验签、订单金额核对、订单查询补偿和自动交付。
- 真实退款和退款查询需单独验证支付宝权限后再启用。