-- 搜索历史表
CREATE TABLE IF NOT EXISTS public.search_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  keyword TEXT NOT NULL,
  search_type TEXT NOT NULL DEFAULT 'video' CHECK (search_type IN ('video', 'user')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- 唯一约束：用户 + 关键词
  CONSTRAINT unique_user_keyword UNIQUE(user_id, keyword)
);

-- 创建索引
CREATE INDEX IF NOT EXISTS idx_search_history_user_time ON public.search_history(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_search_history_keyword_time ON public.search_history(keyword, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_search_history_type ON public.search_history(search_type, created_at DESC);

-- RLS 策略
ALTER TABLE public.search_history ENABLE ROW LEVEL SECURITY;

-- 用户只能查看自己的搜索历史
DROP POLICY IF EXISTS "Users can view own search history" ON public.search_history;
CREATE POLICY "Users can view own search history"
ON public.search_history FOR SELECT
USING (auth.uid() = user_id);

-- 用户只能插入自己的搜索历史
DROP POLICY IF EXISTS "Users can insert own search history" ON public.search_history;
CREATE POLICY "Users can insert own search history"
ON public.search_history FOR INSERT
WITH CHECK (auth.uid() = user_id);

-- 用户只能更新自己的搜索历史
DROP POLICY IF EXISTS "Users can update own search history" ON public.search_history;
CREATE POLICY "Users can update own search history"
ON public.search_history FOR UPDATE
USING (auth.uid() = user_id);

-- 用户只能删除自己的搜索历史
DROP POLICY IF EXISTS "Users can delete own search history" ON public.search_history;
CREATE POLICY "Users can delete own search history"
ON public.search_history FOR DELETE
USING (auth.uid() = user_id);

-- 为视频表添加全文搜索索引
-- 启用 pg_trgm 扩展（如果还没启用）
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- 为描述字段添加三元组索引（支持模糊搜索）
CREATE INDEX IF NOT EXISTS idx_videos_description_trgm 
ON public.videos USING GIN (description gin_trgm_ops);

-- 为标签字段添加 GIN 索引（支持数组搜索）
CREATE INDEX IF NOT EXISTS idx_videos_tags_gin 
ON public.videos USING GIN (tags);

-- 为用户表添加搜索索引
CREATE INDEX IF NOT EXISTS idx_profiles_username_trgm 
ON public.profiles USING GIN (username gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_profiles_nickname_trgm 
ON public.profiles USING GIN (nickname gin_trgm_ops);

-- 优化排序的复合索引
CREATE INDEX IF NOT EXISTS idx_videos_search_sort 
ON public.videos (like_count DESC, comment_count DESC, created_at DESC)
WHERE status = 'published' AND review_status = 'approved';

-- 注释
COMMENT ON TABLE public.search_history IS '用户搜索历史记录表';
COMMENT ON COLUMN public.search_history.keyword IS '搜索关键词';
COMMENT ON COLUMN public.search_history.search_type IS '搜索类型：video=视频，user=用户';
COMMENT ON COLUMN public.search_history.updated_at IS '更新时间（重复搜索时更新）';


