-- 🎯 批量修复合辑中所有视频的play_url都指向错误路径的问题
-- 问题：修复脚本错误地将所有视频的play_url改成了不同的路径，但这些文件不存在
-- 解决方案：如果合辑中所有视频的play_url都指向错误路径，统一改回合辑根路径

-- 批量修复：将所有视频的play_url改回合辑根路径
WITH collections_to_fix AS (
  SELECT DISTINCT v.id
  FROM videos v,
  LATERAL jsonb_array_elements(v.media_list) item
  WHERE v.content_type = 'collection'
    AND item->>'type' = 'video'
    AND item->>'play_url' IS NOT NULL
    AND item->>'play_url' LIKE '/videos/' || v.id || '/%'
    AND item->>'play_url' != '/videos/' || v.id || '/index.m3u8'
    AND item->>'play_url' LIKE '%/index.m3u8'
  GROUP BY v.id
  HAVING COUNT(*) = (
    SELECT COUNT(*) 
    FROM jsonb_array_elements(v.media_list) i 
    WHERE i->>'type' = 'video'
  )
)
UPDATE videos v
SET media_list = (
  SELECT jsonb_agg(
    CASE 
      WHEN item->>'type' = 'video' THEN
        item || jsonb_build_object('play_url', '/videos/' || v.id || '/index.m3u8')
      ELSE item
    END
  )
  FROM jsonb_array_elements(v.media_list) item
),
images = (
  SELECT jsonb_agg(
    CASE 
      WHEN item->>'type' = 'video' THEN
        item || jsonb_build_object('play_url', '/videos/' || v.id || '/index.m3u8')
      ELSE item
    END
  )
  FROM jsonb_array_elements(v.media_list) item
)
WHERE v.id IN (SELECT id FROM collections_to_fix);

-- 返回修复的数量
DO $$
DECLARE
    fixed_count INTEGER;
BEGIN
    GET DIAGNOSTICS fixed_count = ROW_COUNT;
    RAISE NOTICE '已修复 % 个合辑的 play_url', fixed_count;
END $$;

