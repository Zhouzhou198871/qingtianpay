# 晴天支付中心 API 接入说明

## 生产地址与支付方式
- 管理工作台：`https://pay.lynli.me`
- 商城后端 API：`https://pay-api.lynli.me`
- 支付宝异步通知：`https://pay-api.lynli.me/api/alipay/notify`
- 支付方式：`alipay_jsapi`（支付宝授权 JSAPI）及 `alipay_qr`（电脑网页二维码扫码）。
- 金额、商品名称由支付中心读取，不接受商城客户端传入金额。

## 1. 在工作台登记商城
登录 `https://pay.lynli.me`，依次进入「业务网站」添加商城、「商品管理」创建商品、「API 接口管理」为该站点创建独立 API Key。API Key 只展示一次，必须保存在商城服务端环境变量中，不能放进浏览器代码或公开仓库。

## 2. 创建支付订单
商城自己的服务端请求：
`POST https://pay-api.lynli.me/api/v1/payments`

请求头：
```http
Authorization: Bearer <站点专属 API Key>
Content-Type: application/json
```

### 电脑网页二维码
请求体：
```json
{
  "product_id": "支付中心商品ID",
  "external_order_no": "SHOP-20261124-0001",
  "payment_method": "alipay_qr",
  "buyer_ref": "商城内部用户编号"
}
```
成功响应含 `qr_code`，将它交给商城前端二维码组件展示：
```json
{
  "order_no": "QT...",
  "status": "pending",
  "payment_method": "alipay_qr",
  "qr_code": "https://qr.alipay.com/...",
  "expires_in": 900
}
```
二维码内容必须原样使用，不要拼接或改写。

### 手机支付宝 JSAPI
请求体：
```json
{
  "product_id": "支付中心商品ID",
  "external_order_no": "SHOP-20261124-0002",
  "payment_method": "alipay_jsapi",
  "buyer_id": "支付宝授权取得的 buyer_id",
  "buyer_ref": "商城内部用户编号"
}
```
JSAPI 必须传支付宝授权流程取得的真实 `buyer_id`，不能用商城用户 ID 或邮箱代替。响应中的 `trade_no` / `invoke.tradeNO` 交给支付宝客户端 SDK。客户端回调不能作为发货依据。

## Node.js 服务端调用示例
```js
const API = "https://pay-api.lynli.me";
export async function createQingtianPayOrder({
  apiKey, productId, externalOrderNo, paymentMethod, buyerId, buyerRef
}) {
  const response = await fetch(`${API}/api/v1/payments`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      product_id: productId,
      external_order_no: externalOrderNo,
      payment_method: paymentMethod,
      ...(buyerId ? { buyer_id: buyerId } : {}),
      ...(buyerRef ? { buyer_ref: buyerRef } : {})
    })
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.detail || data.error || "支付订单创建失败");
  return data;
}
```

## 3. 查询支付状态
请求 `GET https://pay-api.lynli.me/api/v1/orders/{order_no}`，仍使用站点专属 Bearer API Key。仅能读取该 Key 所属站点订单。商城应以查询接口返回 `status=paid` 或验签成功的服务端 Webhook 事件作为交付依据。

## 4. 自动交付
在工作台创建业务网站时选择 `webhook` 并填写商城 HTTPS 接收地址。支付成功后，支付中心发送 `order.paid` 事件，包含 `x-qingtian-event`、`x-qingtian-signature`（HMAC-SHA256）和 `idempotency-key` 请求头。接收端须按原始请求体校验 HMAC，并用幂等键防止重复交付。签名密钥在工作台该站点「查看签名密钥」处读取并保存在商城服务端。

## 错误与订单规则
- 同一站点 `external_order_no` 必须唯一，重复返回 HTTP 409。
- 商品必须属于当前 API Key 的站点且处于启用状态。
- JSAPI 缺少 `buyer_id` 返回 HTTP 400。
- 商户 PID 未配置时返回 HTTP 503 `alipay_merchant_id_not_configured`，不会创建可收款交易。
- 支付宝创建失败返回 HTTP 502；不要因超时盲目重复创建订单。

## 当前生产验收
服务器 API 已部署并通过健康检查；现已补上 `alipay.trade.precreate` 二维码创建分支。真实支付宝交易尚未验收：健康检查仍显示 `ALIPAY_SELLER_ID` 未配置，且需确认支付宝商户产品权限。配置完成后必须分别验收二维码扫码、JSAPI、异步通知验签、订单状态更新及 Webhook 自动交付，之后才能标记正式可收款。