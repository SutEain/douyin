-- 🎯 防止用户自己解封：增加触发器，禁止「本人」将 is_banned 从 true 改为 false
-- 漏洞背景：之前封禁过的用户仍能解封，可能原因 (1) 曾为 admin 自解封 (2) 某处用 service_role 直接改库
-- 本迁移：在数据层增加硬性规则，不依赖 session 变量——只要「当前登录用户 = 被更新行且正在解封」，直接拒绝

CREATE OR REPLACE FUNCTION public.block_self_unban()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
    -- 仅当「从已封禁变为未封禁」且「被更新的是当前登录用户本人」时拦截
    IF OLD.is_banned = true AND NEW.is_banned = false AND NEW.id = auth.uid() THEN
        RAISE EXCEPTION 'NO'
            USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.block_self_unban() IS 'NO';

DROP TRIGGER IF EXISTS trigger_block_self_unban ON public.profiles;
CREATE TRIGGER trigger_block_self_unban
    BEFORE UPDATE OF is_banned, ban_reason ON public.profiles
    FOR EACH ROW
    WHEN (OLD.is_banned IS DISTINCT FROM NEW.is_banned OR OLD.ban_reason IS DISTINCT FROM NEW.ban_reason)
    EXECUTE FUNCTION public.block_self_unban();
