-- 🎯 删除旧的、不再使用的游戏 RPC 函数
-- 这些函数已被新的 _v2 版本替代

-- 删除旧的骰子游戏函数
DROP FUNCTION IF EXISTS public.create_dice_room(UUID, BIGINT, NUMERIC, INT);
DROP FUNCTION IF EXISTS public.join_dice_room(UUID, UUID);
DROP FUNCTION IF EXISTS public.settle_dice_room(UUID);
DROP FUNCTION IF EXISTS public.cancel_dice_room(UUID, UUID);
DROP FUNCTION IF EXISTS public.refund_dice_room(UUID);
DROP FUNCTION IF EXISTS public.refund_expired_dice_rooms();
DROP FUNCTION IF EXISTS public.check_and_refund_expired_dice_rooms();

-- 删除旧的猜拳游戏函数
DROP FUNCTION IF EXISTS public.create_rps_room(UUID, BIGINT, DECIMAL);
DROP FUNCTION IF EXISTS public.create_rps_room(UUID, BIGINT, NUMERIC);
DROP FUNCTION IF EXISTS public.join_rps_room(UUID, UUID);
DROP FUNCTION IF EXISTS public.save_rps_choice(UUID, UUID, TEXT);
DROP FUNCTION IF EXISTS public.settle_rps_room(UUID);
DROP FUNCTION IF EXISTS public.cancel_rps_room(UUID, UUID);
DROP FUNCTION IF EXISTS public.check_rps_timeout();
