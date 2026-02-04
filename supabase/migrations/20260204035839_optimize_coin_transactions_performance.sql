-- 🚀 优化资金流水列表查询性能
-- 问题：数据量大（24万+），查询慢
-- 优化：添加复合索引、优化查询模式

-- 1. 添加复合索引：user_id + created_at（用于按用户查询）
CREATE INDEX IF NOT EXISTS idx_coin_transactions_user_created 
ON public.coin_transactions(user_id, created_at DESC);

-- 2. 添加复合索引：type + created_at（用于按类型查询）
CREATE INDEX IF NOT EXISTS idx_coin_transactions_type_created 
ON public.coin_transactions(type, created_at DESC);

-- 3. 添加复合索引：created_at + id（用于分页，避免重复排序）
-- 注意：idx_coin_transactions_created_at_id 已存在，但确保顺序正确
-- 如果已存在但顺序不对，先删除再重建
DROP INDEX IF EXISTS idx_coin_transactions_created_at_id;
CREATE INDEX idx_coin_transactions_created_at_id 
ON public.coin_transactions(created_at DESC, id DESC);

-- 4. 为 description 字段添加索引（用于备注搜索）
CREATE INDEX IF NOT EXISTS idx_coin_transactions_description 
ON public.coin_transactions(description) 
WHERE description IS NOT NULL;

-- 5. 为 amount 字段添加索引（用于金额范围查询）
CREATE INDEX IF NOT EXISTS idx_coin_transactions_amount 
ON public.coin_transactions(amount);

-- 6. 为 related_id 字段添加索引（如果经常查询）
CREATE INDEX IF NOT EXISTS idx_coin_transactions_related_id 
ON public.coin_transactions(related_id) 
WHERE related_id IS NOT NULL;

-- 7. 分析表以更新统计信息
ANALYZE public.coin_transactions;

COMMENT ON INDEX idx_coin_transactions_user_created IS '优化：按用户查询资金流水';
COMMENT ON INDEX idx_coin_transactions_type_created IS '优化：按类型查询资金流水';
COMMENT ON INDEX idx_coin_transactions_description IS '优化：备注字段搜索';
COMMENT ON INDEX idx_coin_transactions_amount IS '优化：金额范围查询';
