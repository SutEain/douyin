-- 1. 修复并加固直播消息权限
-- 只有后端 (Service Role) 才能插入类型为 'gift' 的消息
-- 用户只能直接插入 'chat' 类型（普通聊天）的消息

DROP POLICY IF EXISTS "Users can insert messages" ON public.live_broadcast_messages;

-- 策略 1：允许已登录用户发送普通聊天消息
CREATE POLICY "Users can insert chat messages" ON public.live_broadcast_messages
    FOR INSERT TO authenticated
    WITH CHECK (
        auth.uid() = user_id AND 
        msg_type = 'chat'
    );

-- 策略 2：允许 Service Role 插入任何类型的消息（后端代发礼物消息走这里）
-- 注意：Supabase 的 RLS 默认对 service_role 禁用，即 service_role 拥有所有权限。
-- 所以我们只需要限制普通用户的插入权限即可。

-- 策略 3：所有人都可以查看消息
DROP POLICY IF EXISTS "Anyone can view messages" ON public.live_broadcast_messages;
CREATE POLICY "Anyone can view messages" ON public.live_broadcast_messages
    FOR SELECT USING (true);

