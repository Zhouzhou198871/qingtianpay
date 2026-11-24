-- 晴天支付中心第三阶段：退款额度并发保护
-- 同一订单的 pending / processing / succeeded 退款都占用可退额度。
-- 由 SQLite 触发器在数据库写入层兜底，避免并发退款绕过应用层余额检查。

CREATE TRIGGER IF NOT EXISTS refunds_limit_before_insert
BEFORE INSERT ON refunds
WHEN NEW.status IN ('pending', 'processing', 'succeeded')
 AND (
   COALESCE((
     SELECT SUM(amount_minor)
     FROM refunds
     WHERE order_id = NEW.order_id
       AND status IN ('pending', 'processing', 'succeeded')
   ), 0) + NEW.amount_minor
 ) > COALESCE((
   SELECT amount_minor FROM orders WHERE id = NEW.order_id
 ), -1)
BEGIN
  SELECT RAISE(ABORT, 'refund_amount_exceeds_remaining');
END;

CREATE TRIGGER IF NOT EXISTS refunds_limit_before_update
BEFORE UPDATE OF order_id, amount_minor, status ON refunds
WHEN NEW.status IN ('pending', 'processing', 'succeeded')
 AND (
   COALESCE((
     SELECT SUM(amount_minor)
     FROM refunds
     WHERE order_id = NEW.order_id
       AND id != OLD.id
       AND status IN ('pending', 'processing', 'succeeded')
   ), 0) + NEW.amount_minor
 ) > COALESCE((
   SELECT amount_minor FROM orders WHERE id = NEW.order_id
 ), -1)
BEGIN
  SELECT RAISE(ABORT, 'refund_amount_exceeds_remaining');
END;
