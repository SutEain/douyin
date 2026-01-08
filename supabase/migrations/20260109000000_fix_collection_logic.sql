-- 1. 更新 content_type 约束，增加 collection 类型
ALTER TABLE videos DROP CONSTRAINT IF EXISTS videos_content_type_check;
ALTER TABLE videos ADD CONSTRAINT videos_content_type_check 
  CHECK (content_type IN ('video', 'image', 'album', 'collection'));

-- 2. 更新字段注释
COMMENT ON COLUMN videos.content_type IS '内容类型：video=视频, image=单图, album=纯图文相册, collection=混排合集';

-- 3. 创建/更新 append_collection_media RPC 函数
-- 核心逻辑：如果新项是视频，或者原先就是 collection，则保持/变为 collection
CREATE OR REPLACE FUNCTION public.append_collection_media(
    p_chat_id BIGINT,
    p_media_group_id TEXT,
    p_new_item JSONB,
    p_author_id UUID,
    p_caption TEXT DEFAULT NULL,
    p_tags TEXT[] DEFAULT NULL,
    p_content_type TEXT DEFAULT 'album'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_video_id UUID;
    v_media_list JSONB;
    v_media_count INT;
    v_is_new BOOLEAN := FALSE;
    v_current_content_type TEXT;
    v_profile_auto_approve BOOLEAN;
BEGIN
    -- 0. 获取用户免审状态
    SELECT auto_approve INTO v_profile_auto_approve FROM profiles WHERE id = p_author_id;

    -- 1. 查找是否存在该媒体组的记录
    SELECT id, media_list, content_type INTO v_video_id, v_media_list, v_current_content_type
    FROM videos
    WHERE media_group_id = p_media_group_id
      AND author_id = p_author_id
    LIMIT 1;

    -- 2. 如果不存在，创建新记录
    IF v_video_id IS NULL THEN
        v_is_new := TRUE;
        v_media_list := jsonb_build_array(p_new_item);
        
        INSERT INTO videos (
            tg_user_id,
            author_id,
            media_group_id,
            media_list,
            images,
            title,
            description,
            tags,
            content_type,
            status,
            storage_type,
            review_status
        ) VALUES (
            p_chat_id,
            p_author_id,
            p_media_group_id,
            v_media_list,
            v_media_list,
            CASE WHEN p_content_type = 'collection' THEN '未命名合集' ELSE '未命名相册' END,
            p_caption,
            p_tags,
            p_content_type,
            'processing',
            'r2_pending',
            CASE WHEN v_profile_auto_approve THEN 'auto_approved' ELSE 'pending' END
        )
        RETURNING id INTO v_video_id;
    ELSE
        -- 3. 如果已存在，追加媒体项
        v_media_list := COALESCE(v_media_list, '[]'::jsonb) || jsonb_build_array(p_new_item);
        
        -- 核心修复：智能决定 content_type
        -- 如果传入的是 collection (视频)，或者原本就是 collection，则一定是 collection
        IF p_content_type = 'collection' OR v_current_content_type = 'collection' THEN
            v_current_content_type := 'collection';
        ELSE
            -- 否则（传入的是 album 且原本是 album/image），保持 album
            v_current_content_type := 'album';
        END IF;

        UPDATE videos
        SET media_list = v_media_list,
            images = v_media_list,
            content_type = v_current_content_type,
            updated_at = NOW()
        WHERE id = v_video_id;
    END IF;

    v_media_count := jsonb_array_length(v_media_list);

    RETURN jsonb_build_object(
        'id', v_video_id,
        'is_new', v_is_new,
        'media_count', v_media_count
    );
END;
$$;

-- 4. 创建/更新 update_collection_media_item RPC 函数
CREATE OR REPLACE FUNCTION public.update_collection_media_item(
    p_video_id UUID,
    p_file_id TEXT,
    p_play_url TEXT,
    p_cover_url TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_media_list JSONB;
    v_item JSONB;
    v_new_list JSONB := '[]'::jsonb;
BEGIN
    SELECT media_list INTO v_media_list FROM videos WHERE id = p_video_id;
    
    IF v_media_list IS NOT NULL THEN
        FOR v_item IN SELECT * FROM jsonb_array_elements(v_media_list)
        LOOP
            IF v_item->>'file_id' = p_file_id THEN
                v_item := v_item || jsonb_build_object(
                    'play_url', p_play_url,
                    'cover_url', p_cover_url
                );
            END IF;
            v_new_list := v_new_list || jsonb_build_array(v_item);
        END LOOP;
        
        UPDATE videos 
        SET media_list = v_new_list,
            images = v_new_list,
            -- 如果这是第一个有封面的项，且主记录还没封面，顺便更新主记录封面
            cover_url = COALESCE(cover_url, p_cover_url)
        WHERE id = p_video_id;
    END IF;
END;
$$;
