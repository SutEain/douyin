-- 将成人内容每日默认上限从 5 调整为 10

ALTER TABLE public.profiles
ALTER COLUMN adult_daily_limit SET DEFAULT 10;

-- 将仍为旧默认值 5 的用户更新为 10（避免与新规则不一致）
UPDATE public.profiles
SET adult_daily_limit = 10
WHERE adult_daily_limit = 5;


