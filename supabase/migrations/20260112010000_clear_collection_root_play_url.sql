-- 🎯 清除所有合辑的根 play_url
-- 合辑不应该有根 play_url，每个视频都有自己的 play_url 存储在 media_list 中
-- 这个迁移会清除所有合辑的根 play_url，确保合辑类型的数据结构正确

UPDATE videos
SET play_url = NULL
WHERE content_type = 'collection'
  AND play_url IS NOT NULL
  AND play_url LIKE '/videos/%/index.m3u8'
  AND play_url NOT LIKE '/videos/%/%/index.m3u8'; -- 排除正确的格式（包含 fileId）

-- 返回清除的数量
DO $$
DECLARE
    cleared_count INTEGER;
BEGIN
    GET DIAGNOSTICS cleared_count = ROW_COUNT;
    RAISE NOTICE '已清除 % 个合辑的根 play_url', cleared_count;
END $$;

