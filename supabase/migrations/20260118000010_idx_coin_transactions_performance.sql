-- 🎯 为 coin_transactions 表添加索引以解决 Admin 查询超时问题
-- 11.9万行数据在没有索引的情况下进行 JOIN + ORDER BY 极易导致 statement timeout

-- 1. 为 user_id 添加索引（加速 JOIN 和 RLS 过滤）
CREATE INDEX IF NOT EXISTS idx_coin_transactions_user_id ON public.coin_transactions USING btree (user_id);

-- 2. 为 created_at 添加索引（加速默认的 DESC 排序）
CREATE INDEX IF NOT EXISTS idx_coin_transactions_created_at ON public.coin_transactions USING btree (created_at DESC);

-- 3. 为 type 添加索引（加速按类型筛选）
CREATE INDEX IF NOT EXISTS idx_coin_transactions_type ON public.coin_transactions USING btree (type);

-- 4. 优化 RLS 性能
-- 确保 check_is_admin() 函数尽可能快
-- 如果 check_is_admin() 没有标记为 STABLE，在这里更新它
ALTER FUNCTION public.check_is_admin() STABLE;
