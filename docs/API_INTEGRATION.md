# 晴天支付中心 API 接入说明

## 生产地址与支付方式
- 管理工作台：`https://pay.lynli.me`
- 商城后端 API：`https://pay-api.lynli.me`
- 支付宝异步通知：`https://pay-api.lynli.me/api/alipay/notify`
- 电脑浏览器使用 `alipay_page`（支付宝电脑网站支付）。
- 手机浏览器使用 `alipay_wap`（支付宝手机网站支付）。
- 默认支付方式为 `alipay_page`。不使用当面付、扫码预创建，也不要求支付宝 buyer_id。
- 商品金额、名称由支付中心读取，不接受商城客户端传入金额。

## 1. 在工作台登记商城
登录 `https://pay.lynli.me`，依次进入「业务网站」添加商城、「商品管理」创建商品、「API 接口管理」为该站点创建独立 API Key。站点 `base_url` 请填写商城正式 HTTPS 根地址，用于支付宝付款后的返回跳转。API Key 只展示一次，必须保存在商城服务端环境变量中，不能放进浏览器代码或公开仓库。

## 2. 创建支付订单
商城自己的服务端请求：
`POST https://pay-api.lynli.me/api/v1/payments`

请求头：
```http
Authorization: Bearer <站点专属 API Key>
Content-Type: application/json
```

### 电脑网页支付
```json
{
  "product_id": "支付中心商品ID",
  "external_order_no": "SHOP-20261124-0001",
  "payment_method": "alipay_page",
  "buyer_ref": "商城内部用户编号"
}
```

### 手机网页支付
```json
{
  "product_id": "支付中心商品ID",
  "external_order_no": "SHOP-20261124-0002",
  "payment_method": "alipay_wap",
  "buyer_ref": "商城内部用户编号"
}
```

成功响应：
```json
{
  "order_no": "QT...",
  "status": "pending",
  "payment_method": "alipay_page",
  "payment_url": "https://openapi.alipay.com/gateway.do?..."
}
```

商城前端收到响应后，将浏览器导航到 `payment_url`。手机浏览器使用 `alipay_wap`，电脑浏览器使用 `alipay_page`。不要自行修改支付 URL 或其中的签名参数。

## Node.js 服务端调用示例
```js
const API = "https://pay-api.lynli.me";
export async function createQingtianPayOrder({
  apiKey, productId, externalOrderNo, paymentMethod = "alipay_page", buyerRef
}) {
  const response = await fetch(`${API}/api/v1/payments`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      product_id: productId,
      external_order_no: externalOrderNo,
      payment_method: paymentMethod,
      ...(buyerRef ? { buyer_ref: buyerRef } : {})
    })
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.detail || data.error || "支付订单创建失败");
  return data;
}

// 浏览器端拿到 data.payment_url 后执行：
// window.location.assign(data.payment_url);
```

## 3. 查询支付状态
请求 `GET https://pay-api.lynli.me/api/v1/orders/{order_no}`，仍使用站点专属 Bearer API Key。仅能读取该 Key 所属站点订单。商城应以查询接口返回 `status=paid` 或验签成功的服务端 Webhook 事件作为交付依据。支付宝同步返回地址只用于展示结果，不能作为到账凭证。

## 4. 自动交付
在工作台创建业务网站时选择 `webhook` 并填写商城 HTTPS 接收地址。支付成功后，支付中心发送 `order.paid` 事件，包含 `x-qingtian-event`、`x-qingtian-signature`（HMAC-SHA256）和 `idempotency-key` 请求头。接收端须按原始请求体校验 HMAC，并用幂等键防止重复交付。签名密钥在工作台该站点「查看签名密钥」处读取并保存在商城服务端。

## 错误与订单规则
- 同一站点 `external_order_no` 必须唯一，重复返回 HTTP 409。
- 商品必须属于当前 API Key 的站点且处于启用状态。
- 只支持 CNY 商品；金额由支付中心数据库读取。
- 商户 Seller ID 未配置时返回 HTTP 503 `alipay_merchant_id_not_configured`。
- 支付宝网站支付产品权限由支付宝开放平台应用签约情况决定；未开通电脑网站支付或手机网站支付时，不能完成生产收款。
- 支付宝创建失败返回 HTTP 502；不要因超时盲目重复创建订单。

## 当前生产验收
服务器 API 已部署，健康检查已确认数据库、AppID、应用私钥、支付宝公钥及 Seller ID 均已加载。电脑网站支付和手机网站支付请求签名生成代码已部署，服务器端 RSA2 签名自检通过。尚未向支付宝实际发起付款跳转，也未完成真实交易、异步通知与站点自动交付的端到端验收；需确认应用已开通对应网站支付产品权限后继续验收。未完成前不标记为正式收款已验证。
