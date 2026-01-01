-- 东南亚板块流：按时间倒序，严格排除已观看的视频
CREATE OR REPLACE FUNCTION public.get_sea_feed(
    p_user_id UUID,
    p_page_no INT,
    p_page_size INT
) RETURNS SETOF public.videos
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT v.*
    FROM public.videos v
    WHERE v.status = 'published'
      AND v.is_adult = FALSE
      AND v.is_sea = TRUE
      AND NOT EXISTS (
          SELECT 1 FROM public.watch_history wh 
          WHERE wh.user_id = p_user_id AND wh.video_id = v.id
      )
    ORDER BY v.published_at DESC NULLS LAST, v.created_at DESC
    OFFSET p_page_no * p_page_size
    LIMIT p_page_size;
END;
$$;

-- 授予执行权限
GRANT EXECUTE ON FUNCTION public.get_sea_feed(UUID, INT, INT) TO anon;
GRANT EXECUTE ON FUNCTION public.get_sea_feed(UUID, INT, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_sea_feed(UUID, INT, INT) TO service_role;

