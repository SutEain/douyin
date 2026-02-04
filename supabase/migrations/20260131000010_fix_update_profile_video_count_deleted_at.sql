-- 🎯 修复：移除 update_profile_video_count 触发器中对 deleted_at 字段的引用
-- 问题：videos 表的 deleted_at 字段已被删除（改为真删除），但触发器函数仍在使用该字段
-- 错误：record "new" has no field "deleted_at"
-- 修复：移除对 deleted_at 的检查，因为现在使用真删除（物理删除）

CREATE OR REPLACE FUNCTION public.update_profile_video_count()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- 🎯 设置会话变量，允许更新统计字段
  PERFORM set_config('app.allow_statistics_update', 'true', false);
  
  -- 🎯 插入新视频时，增加视频计数（不再检查 deleted_at，因为字段已删除）
  IF TG_OP = 'INSERT' THEN
    UPDATE public.profiles SET video_count = video_count + 1 WHERE id = NEW.author_id;
  -- 🎯 删除视频时，减少视频计数（真删除，不再检查 deleted_at）
  ELSIF TG_OP = 'DELETE' THEN
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

COMMENT ON FUNCTION public.update_profile_video_count IS '更新用户视频计数（插入时+1，删除时-1），已添加统计字段保护支持，已移除 deleted_at 字段引用';
