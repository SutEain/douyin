-- 1. 在 profiles 表中增加 has_watched 标记
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS has_watched BOOLEAN DEFAULT FALSE;

-- 2. 同步存量数据：将所有在观看历史中出现过的用户标记为 TRUE
UPDATE public.profiles 
SET has_watched = TRUE 
WHERE id IN (SELECT DISTINCT user_id FROM public.watch_history);

-- 3. 更新统计 RPC 函数：改为统计 profiles 表中的 has_watched 字段
CREATE OR REPLACE FUNCTION public.get_active_user_count()
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN (SELECT count(*) FROM public.profiles WHERE has_watched = TRUE);
END;
$$;

