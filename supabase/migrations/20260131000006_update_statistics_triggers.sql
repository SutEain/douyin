-- 🎯 更新统计字段触发器：在更新前设置会话变量，允许触发器更新统计字段
-- 问题：protect_sensitive_profile_fields 触发器会阻止统计字段的更新
-- 修复：在触发器函数中设置 app.allow_statistics_update 会话变量，允许更新

-- 1. 更新关注计数触发器
CREATE OR REPLACE FUNCTION public.update_follow_counts()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- 🎯 设置会话变量，允许更新统计字段
  PERFORM set_config('app.allow_statistics_update', 'true', false);
  
  IF TG_OP = 'INSERT' THEN
    UPDATE public.profiles SET following_count = following_count + 1 WHERE id = NEW.follower_id;
    UPDATE public.profiles SET follower_count = follower_count + 1 WHERE id = NEW.followee_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.profiles SET following_count = GREATEST(following_count - 1, 0) WHERE id = OLD.follower_id;
    UPDATE public.profiles SET follower_count = GREATEST(follower_count - 1, 0) WHERE id = OLD.followee_id;
  END IF;
  
  -- 🎯 重置会话变量
  PERFORM set_config('app.allow_statistics_update', 'false', false);
  
  RETURN NULL;
EXCEPTION
  WHEN OTHERS THEN
    -- 🎯 确保异常时也重置会话变量
    PERFORM set_config('app.allow_statistics_update', 'false', false);
    RAISE;
END;
$$;

COMMENT ON FUNCTION public.update_follow_counts IS '更新用户关注计数（插入时+1，删除时-1），已添加统计字段保护支持';

-- 2. 更新视频点赞计数触发器
CREATE OR REPLACE FUNCTION public.update_video_like_count()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- 🎯 设置会话变量，允许更新统计字段
  PERFORM set_config('app.allow_statistics_update', 'true', false);
  
  IF TG_OP = 'INSERT' THEN
    UPDATE public.videos SET like_count = like_count + 1 WHERE id = NEW.video_id;
    UPDATE public.profiles SET total_likes = total_likes + 1 
    WHERE id = (SELECT author_id FROM public.videos WHERE id = NEW.video_id);
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.videos SET like_count = GREATEST(like_count - 1, 0) WHERE id = OLD.video_id;
    UPDATE public.profiles SET total_likes = GREATEST(total_likes - 1, 0)
    WHERE id = (SELECT author_id FROM public.videos WHERE id = OLD.video_id);
  END IF;
  
  -- 🎯 重置会话变量
  PERFORM set_config('app.allow_statistics_update', 'false', false);
  
  RETURN NULL;
EXCEPTION
  WHEN OTHERS THEN
    -- 🎯 确保异常时也重置会话变量
    PERFORM set_config('app.allow_statistics_update', 'false', false);
    RAISE;
END;
$$;

COMMENT ON FUNCTION public.update_video_like_count IS '更新视频点赞计数和用户总获赞数（插入时+1，删除时-1），已添加统计字段保护支持';

-- 3. 更新用户视频计数触发器
CREATE OR REPLACE FUNCTION public.update_profile_video_count()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- 🎯 设置会话变量，允许更新统计字段
  PERFORM set_config('app.allow_statistics_update', 'true', false);
  
  IF TG_OP = 'INSERT' AND NEW.deleted_at IS NULL THEN
    UPDATE public.profiles SET video_count = video_count + 1 WHERE id = NEW.author_id;
  ELSIF TG_OP = 'DELETE' OR (TG_OP = 'UPDATE' AND OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL) THEN
    UPDATE public.profiles SET video_count = GREATEST(video_count - 1, 0) WHERE id = OLD.author_id;
  END IF;
  
  -- 🎯 重置会话变量
  PERFORM set_config('app.allow_statistics_update', 'false', false);
  
  RETURN COALESCE(NEW, OLD);
EXCEPTION
  WHEN OTHERS THEN
    -- 🎯 确保异常时也重置会话变量
    PERFORM set_config('app.allow_statistics_update', 'false', false);
    RAISE;
END;
$$;

COMMENT ON FUNCTION public.update_profile_video_count IS '更新用户视频计数（插入时+1，删除时-1），已添加统计字段保护支持';
