-- 增加频道属性列
ALTER TABLE public.bound_channels 
ADD COLUMN IF NOT EXISTS is_adult BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS is_sea BOOLEAN DEFAULT FALSE;

-- 更新 RLS 策略（如果需要）
-- 现有的策略已经覆盖了，因为 service_role 可以操作所有列。

