# 晴天支付中心业务网站接入

生产 API：`https://pay-api.lynli.me`  
管理后台：`https://pay.lynli.me`

## 1. 登记业务网站并取得独立凭证

在管理后台「业务网站」中登记网站。创建成功时，支付中心会自动生成该站点独立的 API Key，并且只显示一次。请立即保存到该业务网站的服务端环境变量（例如 `QINGTIANPAY_API_KEY`），不要放进浏览器代码、前端构建变量或客户端 App。

每个站点独立隔离订单和支付数据。API Key 只保存 SHA-256 摘要；遗失后请在「API 接口管理」重新创建并吊销旧 Key。

## 2. 创建支付订单

请求：

```http
POST https://pay-api.lynli.me/api/v1/payments
Authorization: Bearer <该站点的 API Key>
Content-Type: application/json
```

不依赖支付中心商品目录的标准请求：

```json
{
  "external_order_no": "SHOP-20261125-0001",
  "amount": "29.90",
  "subject": "商品名称",
  "payment_method": "alipay_jsapi",
  "buyer_ref": "业务网站内部用户编号",
  "metadata": { "source": "website" }
}
```

也可以传整数分：`amount_minor: 2990`。金额必须由业务网站服务端传入；不要信任浏览器直接提交的金额。若希望使用支付中心商品目录，可改传 `product_id`，金额和标题将以已登记商品为准。币种目前仅支持 CNY。同一站点的 `external_order_no` 必须唯一。

成功响应包含：

- `order_no`：支付中心订单号
- `checkout_url`：支付中心托管收银台链接
- `qr_image_url`：该收银台链接的二维码图片
- `amount_minor`、`currency`、`status`

业务网站将用户引导至 `checkout_url`，或展示 `qr_image_url`。二维码编码的是支付中心收银台链接，并非支付宝当面付原生收款码。

## 3. 支付宝 JSAPI 支付流程

1. 用户打开支付中心 `checkout_url`。
2. 支付中心跳转支付宝官方 OAuth `auth_base` 授权，取得支付宝当前用户的 `user_id`。
3. 支付中心服务端调用官方 `alipay.trade.create`，使用 `product_code=JSAPI_PAY` 创建交易。
4. 支付中心付款启动页在支付宝支持的容器中调用 `AlipayJSBridge.call('tradePay', { tradeNO })`。
5. 支付宝异步通知由支付中心验签、核对商户、订单号和金额后更新订单；付款页同时轮询支付中心订单状态。
6. 只有服务端确认支付成功后，才会建立交付任务。

业务网站不需要自己收集支付宝 `buyer_id`，也不需要把支付宝用户 ID 作为创建订单的参数传入。当前仅支持支付宝 JSAPI，不会回退到手机网站支付、电脑网站支付或当面付。

## 4. 查询订单

```http
GET https://pay-api.lynli.me/api/v1/orders/{order_no}
Authorization: Bearer <该站点的 API Key>
```

仅能查询当前 API Key 所属站点的订单。对待支付订单，服务端会尝试调用支付宝交易查询进行状态补偿，并核对商户与金额。

## 5. 自动交付（Webhook）

创建业务网站时选择「Webhook 自动交付」，填写可公开访问的 HTTPS 接收地址。支付中心会为站点生成独立签名密钥；创建时在后台显示，请保存到该业务网站服务端环境变量，切勿暴露给浏览器。

支付成功后，支付中心发送 `order.paid` JSON，包含订单号、站点 ID、商品信息、金额和幂等键，并附带：

- `x-qingtian-event: order.paid`
- `x-qingtian-signature: <HMAC-SHA256 十六进制签名>`
- `idempotency-key: delivery:<内部订单 ID>`

接收端必须对**原始请求 body 字节**计算 HMAC-SHA256，并以常量时间比较签名；按幂等键防止重复发货，成功处理后返回 2xx。支付中心记录交付结果，失败任务可在管理后台重试。

选择「人工交付」时，支付成功会生成待处理交付记录，由管理员在交付管理中确认完成。选择「内部交付」不会调用外部网站。

## 6. 退款

管理员在后台选择已支付订单并发起退款。退款金额受原订单剩余可退额度限制；调用支付宝官方退款接口后，若渠道结果不明确，退款会保持处理中，可使用「核对渠道」查询支付宝退款结果。不要仅凭前端提交结果认定退款成功。

## 7. 上线边界

- 支付中心基础 API、管理后台、支付宝 JSAPI 服务端流程及生产配置已部署。
- 每个业务网站必须先登记并保存自己的 API Key，配置其订单创建和交付接收逻辑。
- 真实支付宝客户端唤起与实际交易通知闭环尚未完成真实交易端到端验收；在完成前，不应把生产支付描述为已全面验收。
