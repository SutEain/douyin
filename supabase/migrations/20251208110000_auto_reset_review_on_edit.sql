-- 创建触发器函数：当已审核视频被编辑描述/标签时，自动重置审核状态
CREATE OR REPLACE FUNCTION reset_review_status_on_edit()
RETURNS TRIGGER AS $$
BEGIN
  -- 只有在描述或标签被修改时才触发
  IF (OLD.description IS DISTINCT FROM NEW.description) OR
     (OLD.tags IS DISTINCT FROM NEW.tags) THEN
    
    -- 如果视频已通过审核（published + approved）
    IF OLD.status = 'published' AND OLD.review_status = 'approved' THEN
      -- 回退到就绪状态，等待重新审核
      NEW.status := 'ready';
      NEW.review_status := 'pending';
      
      RAISE NOTICE '视频 % 内容已修改，审核状态已重置', NEW.id;
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 创建触发器
DROP TRIGGER IF EXISTS trigger_reset_review_on_edit ON videos;
CREATE TRIGGER trigger_reset_review_on_edit
  BEFORE UPDATE ON videos
  FOR EACH ROW
  EXECUTE FUNCTION reset_review_status_on_edit();

-- 注释
COMMENT ON FUNCTION reset_review_status_on_edit() IS '当已审核通过的视频被编辑描述或标签时，自动将状态从 published 改回 ready，审核状态改为 pending';
COMMENT ON TRIGGER trigger_reset_review_on_edit ON videos IS '自动重置编辑后视频的审核状态';

