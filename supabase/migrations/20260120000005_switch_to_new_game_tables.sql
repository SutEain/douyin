-- 🎯 切换游戏表：将新表重命名为正式表，旧表备份
-- 注意：执行此迁移前，确保所有旧游戏已完成或已取消

-- ============================================================================
-- 第一部分：备份旧表
-- ============================================================================

-- 1. 备份旧表（重命名为 _old）
ALTER TABLE IF EXISTS public.dice_rooms RENAME TO dice_rooms_old;
ALTER TABLE IF EXISTS public.dice_room_players RENAME TO dice_room_players_old;
ALTER TABLE IF EXISTS public.rps_rooms RENAME TO rps_rooms_old;

-- ============================================================================
-- 第二部分：将新表重命名为正式表
-- ============================================================================

-- 2. 重命名新表
ALTER TABLE public.dice_rooms_new RENAME TO dice_rooms;
ALTER TABLE public.dice_room_players_new RENAME TO dice_room_players;
ALTER TABLE public.rps_rooms_new RENAME TO rps_rooms;

-- ============================================================================
-- 第三部分：重命名 RPC 函数（删除 _v2 后缀）
-- ============================================================================

-- 3. 重命名骰子游戏 RPC 函数
ALTER FUNCTION public.create_dice_room_v2(UUID, BIGINT, NUMERIC, INT) RENAME TO create_dice_room;
ALTER FUNCTION public.join_dice_room_v2(UUID, UUID) RENAME TO join_dice_room;
ALTER FUNCTION public.settle_dice_room_v2(UUID, TEXT) RENAME TO settle_dice_room;
ALTER FUNCTION public.cancel_dice_room_v2(UUID, UUID) RENAME TO cancel_dice_room;

-- 4. 重命名猜拳游戏 RPC 函数
ALTER FUNCTION public.create_rps_room_v2(UUID, BIGINT, NUMERIC) RENAME TO create_rps_room;
ALTER FUNCTION public.join_rps_room_v2(UUID, UUID) RENAME TO join_rps_room;
ALTER FUNCTION public.make_rps_choice_v2(UUID, UUID, TEXT) RENAME TO make_rps_choice;
ALTER FUNCTION public.cancel_rps_room_v2(UUID, UUID) RENAME TO cancel_rps_room;

-- ============================================================================
-- 第四部分：删除旧的 RPC 函数（如果存在）
-- ============================================================================

-- 5. 删除旧的骰子游戏函数（如果存在）
DROP FUNCTION IF EXISTS public.create_dice_room(UUID, BIGINT, NUMERIC, INT);
DROP FUNCTION IF EXISTS public.join_dice_room(UUID, UUID);
DROP FUNCTION IF EXISTS public.settle_dice_room(UUID);
DROP FUNCTION IF EXISTS public.cancel_dice_room(UUID, UUID);
DROP FUNCTION IF EXISTS public.refund_dice_room(UUID);
DROP FUNCTION IF EXISTS public.refund_expired_dice_rooms();

-- 6. 删除旧的猜拳游戏函数（如果存在）
DROP FUNCTION IF EXISTS public.create_rps_room(UUID, BIGINT, DECIMAL);
DROP FUNCTION IF EXISTS public.join_rps_room(UUID, UUID);
DROP FUNCTION IF EXISTS public.save_rps_choice(UUID, UUID, TEXT);
DROP FUNCTION IF EXISTS public.settle_rps_room(UUID);
DROP FUNCTION IF EXISTS public.cancel_rps_room(UUID, UUID);
DROP FUNCTION IF EXISTS public.check_rps_timeout();

-- ============================================================================
-- 第五部分：更新授权（使用新函数名）
-- ============================================================================

-- 7. 重新授权（使用新函数名）
GRANT EXECUTE ON FUNCTION public.create_dice_room(UUID, BIGINT, NUMERIC, INT) TO service_role;
GRANT EXECUTE ON FUNCTION public.join_dice_room(UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.settle_dice_room(UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.cancel_dice_room(UUID, UUID) TO service_role;

GRANT EXECUTE ON FUNCTION public.create_rps_room(UUID, BIGINT, NUMERIC) TO service_role;
GRANT EXECUTE ON FUNCTION public.join_rps_room(UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.make_rps_choice(UUID, UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.cancel_rps_room(UUID, UUID) TO service_role;

-- ============================================================================
-- 第六部分：更新索引名称（如果需要）
-- ============================================================================

-- 8. 重命名索引（保持一致性）
DO $$
BEGIN
    -- 骰子游戏索引
    IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_dice_rooms_new_group_status') THEN
        ALTER INDEX idx_dice_rooms_new_group_status RENAME TO idx_dice_rooms_group_status;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_dice_rooms_new_status') THEN
        ALTER INDEX idx_dice_rooms_new_status RENAME TO idx_dice_rooms_status;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_dice_room_players_new_room') THEN
        ALTER INDEX idx_dice_room_players_new_room RENAME TO idx_dice_room_players_room;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_dice_rooms_new_unique_waiting') THEN
        ALTER INDEX idx_dice_rooms_new_unique_waiting RENAME TO idx_dice_rooms_unique_waiting;
    END IF;
    
    -- 猜拳游戏索引
    IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_rps_rooms_new_group_status') THEN
        ALTER INDEX idx_rps_rooms_new_group_status RENAME TO idx_rps_rooms_group_status;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_rps_rooms_new_status') THEN
        ALTER INDEX idx_rps_rooms_new_status RENAME TO idx_rps_rooms_status;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_rps_rooms_new_unique_waiting') THEN
        ALTER INDEX idx_rps_rooms_new_unique_waiting RENAME TO idx_rps_rooms_unique_waiting;
    END IF;
END $$;

-- ============================================================================
-- 完成
-- ============================================================================

-- 注意：
-- 1. 旧表已备份为 _old 后缀，可以保留一段时间用于数据迁移
-- 2. 如果确认不需要旧数据，可以手动删除：
--    DROP TABLE IF EXISTS public.dice_rooms_old CASCADE;
--    DROP TABLE IF EXISTS public.dice_room_players_old CASCADE;
--    DROP TABLE IF EXISTS public.rps_rooms_old CASCADE;
-- 3. Edge Function 代码需要更新，使用新的函数名（去掉 _v2 后缀）
