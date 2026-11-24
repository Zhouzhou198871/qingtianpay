# Worker API 部署说明

晴天支付中心 Worker：`qingtianpay-api`

- API 域名：`https://pay.lynli.me/api/*`
- Worker：`qingtianpay-api`
- D1：`qingtianpay-db`
- D1 ID：`c669c051-d2e2-46cb-8356-25a7ba3350ce`
- 生产管理后台来源：`https://pay.lynli.me`

## 当前 Cloudflare 资源

已创建全新的 `qingtianpay-db`，并执行 `0001_initial_schema.sql` 和 `0002_security_bootstrap.sql` 对应结构。数据库包含管理员、站点、API Key、商品、订单、支付、退款、交付、日志和系统设置等表。

旧数据库 `qingtian-pay-auth` 不属于本项目，禁止绑定、迁移或修改。

Worker 已部署并绑定新 D1，`pay.lynli.me/api/*` 路由已指向该 Worker。健康检查已验证返回：

```json
{"ok":true,"service":"qingtianpay-api","database":"connected"}
```

## 必须配置的 Worker Secrets

在 Cloudflare Worker `qingtianpay-api` 的 Settings → Variables and Secrets 中配置：

- `ALIPAY_PRIVATE_KEY`：与支付宝开放平台应用公钥配对的 PKCS#8 应用私钥。
- `ALIPAY_PUBLIC_KEY`：支付宝开放平台提供的支付宝公钥。
- `BOOTSTRAP_SECRET`：至少 32 字符随机值，用于一次性初始化三个受保护超级管理员密码。
- `DELIVERY_SIGNING_SECRET`：至少 32 字符随机值，用于业务网站交付 Webhook 的 HMAC 签名。

不要把私钥、初始化密钥或交付签名密钥写入 GitHub、前端代码或 D1 明文表。

AppID 通过 Worker 普通变量 `ALIPAY_APP_ID` 配置。当前值已写入 Worker 配置。

## 管理员初始化

数据库中已预置三个受保护超级管理员邮箱，初始状态为 pending。配置 `BOOTSTRAP_SECRET` 后，使用：

`POST /api/auth/bootstrap`

请求头：`X-Bootstrap-Secret: <BOOTSTRAP_SECRET>`

请求体：`{"password":"<管理员自行设置的新密码>" }`

密码最少 12 位。成功后 bootstrap 会永久关闭；三个账号使用相同的安全哈希，不保存明文密码。不要在聊天、代码或提交记录中传输管理员密码。

## 支付流程

- 创建 JSAPI 订单：`POST /api/v1/payments`
- 支付宝异步通知：`POST /api/alipay/notify`
- 订单状态查询：`GET /api/v1/orders/{order_no}`
- 管理员退款：`POST /api/refunds`
- 交付记录：`GET /api/deliveries`
- 交付重试：`POST /api/deliveries/{id}/retry`

支付以服务端验签通知为准。JSAPI 客户端回调仅用于界面展示，不能直接触发交付。

## 上线前验收

在配置密钥后，仍必须完成：
1. 使用支付宝沙箱或正式测试账号完成 JSAPI 下单和客户端唤起。
2. 验证 RSA2 请求签名、通知验签、AppID、订单号和金额核对。
3. 测试重复通知、通知乱序、超时查询和退款。
4. 为每个业务网站配置 webhook 地址并完成签名验证、幂等交付测试。
5. 完成登录、会话、管理员权限和安全测试。

当前健康检查和 D1 连接已验证；真实支付宝收款与业务网站交付尚未完成端到端验收，禁止标记为正式可收款。
