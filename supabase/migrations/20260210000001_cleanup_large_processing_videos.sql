-- 清理超过 100MB 的待处理视频任务
-- 目标：删除 file_size > 100MB 且 status = 'processing' 的视频记录

-- 1. 先查看符合条件的记录数量和总大小
DO $$
DECLARE
    record_count BIGINT;
    total_size BIGINT;
    size_mb NUMERIC;
BEGIN
    -- 统计符合条件的记录
    SELECT COUNT(*), COALESCE(SUM(file_size), 0)
    INTO record_count, total_size
    FROM public.videos
    WHERE status = 'processing'
      AND file_size > 104857600; -- 100MB = 104857600 字节
    
    size_mb := ROUND(total_size::NUMERIC / 1048576, 2);
    
    RAISE NOTICE '=== 清理前统计 ===';
    RAISE NOTICE '符合条件的记录数: %', record_count;
    RAISE NOTICE '总大小: % MB (% 字节)', size_mb, total_size;
    
    -- 如果记录数 > 0，执行删除
    IF record_count > 0 THEN
        RAISE NOTICE '';
        RAISE NOTICE '开始删除...';
        
        -- 删除符合条件的记录
        DELETE FROM public.videos
        WHERE status = 'processing'
          AND file_size > 104857600;
        
        RAISE NOTICE '✅ 已删除 % 条记录，释放约 % MB 空间', record_count, size_mb;
    ELSE
        RAISE NOTICE '✅ 没有符合条件的记录，无需清理';
    END IF;
END $$;

-- 2. 清理后统计（验证）
SELECT 
    COUNT(*) as remaining_processing_count,
    COALESCE(SUM(file_size), 0) as remaining_total_size_bytes,
    ROUND(COALESCE(SUM(file_size), 0)::NUMERIC / 1048576, 2) as remaining_total_size_mb
FROM public.videos
WHERE status = 'processing';
