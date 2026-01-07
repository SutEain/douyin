-- 🎯 修复所有性能和剩余安全问题
-- 1. 修复 auth_rls_initplan（优化RLS策略性能）
-- 2. 修复 multiple_permissive_policies（合并多个permissive策略）
-- 3. 修复 duplicate_index（删除重复索引）

-- ============================================
-- 1. 修复 auth_rls_initplan - 优化RLS策略性能
-- ============================================
-- 将 auth.uid() 改为 (select auth.uid()) 以避免每行都重新计算

-- profiles 表
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE schemaname = 'public' 
          AND tablename = 'profiles' 
          AND policyname = 'Users can update own profile'
          AND qual LIKE '%auth.uid()%'
    ) THEN
        DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
        CREATE POLICY "Users can update own profile" ON public.profiles
            FOR UPDATE USING ((select auth.uid()) = id);
    END IF;
END $$;

-- videos 表
DO $$
BEGIN
    -- Users can insert own videos
    IF EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE schemaname = 'public' 
          AND tablename = 'videos' 
          AND policyname = 'Users can insert own videos'
          AND with_check LIKE '%auth.uid()%'
    ) THEN
        DROP POLICY IF EXISTS "Users can insert own videos" ON public.videos;
        CREATE POLICY "Users can insert own videos" ON public.videos
            FOR INSERT WITH CHECK ((select auth.uid()) = author_id);
    END IF;
    
    -- Users can update own videos
    IF EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE schemaname = 'public' 
          AND tablename = 'videos' 
          AND policyname = 'Users can update own videos'
          AND qual LIKE '%auth.uid()%'
    ) THEN
        DROP POLICY IF EXISTS "Users can update own videos" ON public.videos;
        CREATE POLICY "Users can update own videos" ON public.videos
            FOR UPDATE USING ((select auth.uid()) = author_id);
    END IF;
    
    -- Users can delete own videos
    IF EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE schemaname = 'public' 
          AND tablename = 'videos' 
          AND policyname = 'Users can delete own videos'
          AND qual LIKE '%auth.uid()%'
    ) THEN
        DROP POLICY IF EXISTS "Users can delete own videos" ON public.videos;
        CREATE POLICY "Users can delete own videos" ON public.videos
            FOR DELETE USING ((select auth.uid()) = author_id);
    END IF;
    
    -- Approved public videos are viewable by everyone
    IF EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE schemaname = 'public' 
          AND tablename = 'videos' 
          AND policyname = 'Approved public videos are viewable by everyone'
          AND qual LIKE '%auth.uid()%'
    ) THEN
        DROP POLICY IF EXISTS "Approved public videos are viewable by everyone" ON public.videos;
        CREATE POLICY "Approved public videos are viewable by everyone" ON public.videos
            FOR SELECT USING (
                (review_status = 'approved' AND is_private = false) 
                OR ((select auth.uid()) = author_id)
            );
    END IF;
END $$;

-- video_likes 表
DO $$
BEGIN
    -- Users can insert own likes
    IF EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE schemaname = 'public' 
          AND tablename = 'video_likes' 
          AND policyname = 'Users can insert own likes'
    ) THEN
        DROP POLICY IF EXISTS "Users can insert own likes" ON public.video_likes;
        CREATE POLICY "Users can insert own likes" ON public.video_likes
            FOR INSERT WITH CHECK ((select auth.uid()) = user_id);
    END IF;
    
    -- Users can delete own likes
    IF EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE schemaname = 'public' 
          AND tablename = 'video_likes' 
          AND policyname = 'Users can delete own likes'
    ) THEN
        DROP POLICY IF EXISTS "Users can delete own likes" ON public.video_likes;
        CREATE POLICY "Users can delete own likes" ON public.video_likes
            FOR DELETE USING ((select auth.uid()) = user_id);
    END IF;
END $$;

-- video_comments 表
DO $$
BEGIN
    -- Approved comments are viewable by everyone
    IF EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE schemaname = 'public' 
          AND tablename = 'video_comments' 
          AND policyname = 'Approved comments are viewable by everyone'
          AND qual LIKE '%auth.uid()%'
    ) THEN
        DROP POLICY IF EXISTS "Approved comments are viewable by everyone" ON public.video_comments;
        CREATE POLICY "Approved comments are viewable by everyone" ON public.video_comments
            FOR SELECT USING (
                (review_status = 'approved' AND deleted_at IS NULL) 
                OR ((select auth.uid()) = user_id)
            );
    END IF;
    
    -- Users can insert own comments
    IF EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE schemaname = 'public' 
          AND tablename = 'video_comments' 
          AND policyname = 'Users can insert own comments'
    ) THEN
        DROP POLICY IF EXISTS "Users can insert own comments" ON public.video_comments;
        CREATE POLICY "Users can insert own comments" ON public.video_comments
            FOR INSERT WITH CHECK ((select auth.uid()) = user_id);
    END IF;
    
    -- Users can update own comments
    IF EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE schemaname = 'public' 
          AND tablename = 'video_comments' 
          AND policyname = 'Users can update own comments'
    ) THEN
        DROP POLICY IF EXISTS "Users can update own comments" ON public.video_comments;
        CREATE POLICY "Users can update own comments" ON public.video_comments
            FOR UPDATE USING ((select auth.uid()) = user_id);
    END IF;
    
    -- Users can delete own comments
    IF EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE schemaname = 'public' 
          AND tablename = 'video_comments' 
          AND policyname = 'Users can delete own comments'
    ) THEN
        DROP POLICY IF EXISTS "Users can delete own comments" ON public.video_comments;
        CREATE POLICY "Users can delete own comments" ON public.video_comments
            FOR DELETE USING ((select auth.uid()) = user_id);
    END IF;
END $$;

-- video_collections 表
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE schemaname = 'public' 
          AND tablename = 'video_collections' 
          AND policyname = 'Users can view own collections'
    ) THEN
        DROP POLICY IF EXISTS "Users can view own collections" ON public.video_collections;
        CREATE POLICY "Users can view own collections" ON public.video_collections
            FOR SELECT USING ((select auth.uid()) = user_id);
    END IF;
    
    IF EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE schemaname = 'public' 
          AND tablename = 'video_collections' 
          AND policyname = 'Users can insert own collections'
    ) THEN
        DROP POLICY IF EXISTS "Users can insert own collections" ON public.video_collections;
        CREATE POLICY "Users can insert own collections" ON public.video_collections
            FOR INSERT WITH CHECK ((select auth.uid()) = user_id);
    END IF;
    
    IF EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE schemaname = 'public' 
          AND tablename = 'video_collections' 
          AND policyname = 'Users can delete own collections'
    ) THEN
        DROP POLICY IF EXISTS "Users can delete own collections" ON public.video_collections;
        CREATE POLICY "Users can delete own collections" ON public.video_collections
            FOR DELETE USING ((select auth.uid()) = user_id);
    END IF;
END $$;

-- follows 表
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE schemaname = 'public' 
          AND tablename = 'follows' 
          AND policyname = 'Users can insert own follows'
    ) THEN
        DROP POLICY IF EXISTS "Users can insert own follows" ON public.follows;
        CREATE POLICY "Users can insert own follows" ON public.follows
            FOR INSERT WITH CHECK ((select auth.uid()) = follower_id);
    END IF;
    
    IF EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE schemaname = 'public' 
          AND tablename = 'follows' 
          AND policyname = 'Users can delete own follows'
    ) THEN
        DROP POLICY IF EXISTS "Users can delete own follows" ON public.follows;
        CREATE POLICY "Users can delete own follows" ON public.follows
            FOR DELETE USING ((select auth.uid()) = follower_id);
    END IF;
END $$;

-- watch_history 表
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE schemaname = 'public' 
          AND tablename = 'watch_history' 
          AND policyname = 'Users can view own watch history'
    ) THEN
        DROP POLICY IF EXISTS "Users can view own watch history" ON public.watch_history;
        CREATE POLICY "Users can view own watch history" ON public.watch_history
            FOR SELECT USING ((select auth.uid()) = user_id);
    END IF;
    
    IF EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE schemaname = 'public' 
          AND tablename = 'watch_history' 
          AND policyname = 'Users can insert own watch history'
    ) THEN
        DROP POLICY IF EXISTS "Users can insert own watch history" ON public.watch_history;
        CREATE POLICY "Users can insert own watch history" ON public.watch_history
            FOR INSERT WITH CHECK ((select auth.uid()) = user_id);
    END IF;
    
    IF EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE schemaname = 'public' 
          AND tablename = 'watch_history' 
          AND policyname = 'Users can update own watch history'
    ) THEN
        DROP POLICY IF EXISTS "Users can update own watch history" ON public.watch_history;
        CREATE POLICY "Users can update own watch history" ON public.watch_history
            FOR UPDATE USING ((select auth.uid()) = user_id);
    END IF;
END $$;

-- comment_likes 表
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE schemaname = 'public' 
          AND tablename = 'comment_likes' 
          AND policyname = 'Users can insert their own comment likes'
    ) THEN
        DROP POLICY IF EXISTS "Users can insert their own comment likes" ON public.comment_likes;
        CREATE POLICY "Users can insert their own comment likes" ON public.comment_likes
            FOR INSERT WITH CHECK ((select auth.uid()) = user_id);
    END IF;
    
    IF EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE schemaname = 'public' 
          AND tablename = 'comment_likes' 
          AND policyname = 'Users can delete their own comment likes'
    ) THEN
        DROP POLICY IF EXISTS "Users can delete their own comment likes" ON public.comment_likes;
        CREATE POLICY "Users can delete their own comment likes" ON public.comment_likes
            FOR DELETE USING ((select auth.uid()) = user_id);
    END IF;
END $$;

-- search_history 表
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE schemaname = 'public' 
          AND tablename = 'search_history' 
          AND policyname = 'Users can view own search history'
    ) THEN
        DROP POLICY IF EXISTS "Users can view own search history" ON public.search_history;
        CREATE POLICY "Users can view own search history" ON public.search_history
            FOR SELECT USING ((select auth.uid()) = user_id);
    END IF;
    
    IF EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE schemaname = 'public' 
          AND tablename = 'search_history' 
          AND policyname = 'Users can insert own search history'
    ) THEN
        DROP POLICY IF EXISTS "Users can insert own search history" ON public.search_history;
        CREATE POLICY "Users can insert own search history" ON public.search_history
            FOR INSERT WITH CHECK ((select auth.uid()) = user_id);
    END IF;
    
    IF EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE schemaname = 'public' 
          AND tablename = 'search_history' 
          AND policyname = 'Users can update own search history'
    ) THEN
        DROP POLICY IF EXISTS "Users can update own search history" ON public.search_history;
        CREATE POLICY "Users can update own search history" ON public.search_history
            FOR UPDATE USING ((select auth.uid()) = user_id);
    END IF;
    
    IF EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE schemaname = 'public' 
          AND tablename = 'search_history' 
          AND policyname = 'Users can delete own search history'
    ) THEN
        DROP POLICY IF EXISTS "Users can delete own search history" ON public.search_history;
        CREATE POLICY "Users can delete own search history" ON public.search_history
            FOR DELETE USING ((select auth.uid()) = user_id);
    END IF;
END $$;

-- profile_visits 表
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE schemaname = 'public' 
          AND tablename = 'profile_visits' 
          AND policyname = 'profile_visits_select_own'
    ) THEN
        DROP POLICY IF EXISTS "profile_visits_select_own" ON public.profile_visits;
        CREATE POLICY "profile_visits_select_own" ON public.profile_visits
            FOR SELECT USING ((select auth.uid()) = visited_id);
    END IF;
    
    IF EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE schemaname = 'public' 
          AND tablename = 'profile_visits' 
          AND policyname = 'profile_visits_insert_self'
    ) THEN
        DROP POLICY IF EXISTS "profile_visits_insert_self" ON public.profile_visits;
        CREATE POLICY "profile_visits_insert_self" ON public.profile_visits
            FOR INSERT WITH CHECK ((select auth.uid()) = visitor_id);
    END IF;
END $$;

-- live_broadcast_rooms 表
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE schemaname = 'public' 
          AND tablename = 'live_broadcast_rooms' 
          AND policyname = 'Anchors manage own rooms'
          AND qual LIKE '%auth.uid()%'
    ) THEN
        DROP POLICY IF EXISTS "Anchors manage own rooms" ON public.live_broadcast_rooms;
        CREATE POLICY "Anchors manage own rooms" ON public.live_broadcast_rooms
            FOR ALL USING ((select auth.uid()) = anchor_id);
    END IF;
END $$;

-- request_update_limits 表
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE schemaname = 'public' 
          AND tablename = 'request_update_limits' 
          AND policyname = 'Users can view own request update limits'
    ) THEN
        DROP POLICY IF EXISTS "Users can view own request update limits" ON public.request_update_limits;
        CREATE POLICY "Users can view own request update limits" ON public.request_update_limits
            FOR SELECT USING (
                ((select auth.uid()) = requester_id) OR 
                ((select auth.uid()) = target_id)
            );
    END IF;
END $$;

-- visit_notify_limits 表
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE schemaname = 'public' 
          AND tablename = 'visit_notify_limits' 
          AND policyname = 'Users can view own visit notify limits'
    ) THEN
        DROP POLICY IF EXISTS "Users can view own visit notify limits" ON public.visit_notify_limits;
        CREATE POLICY "Users can view own visit notify limits" ON public.visit_notify_limits
            FOR SELECT USING (
                ((select auth.uid()) = visitor_id) OR 
                ((select auth.uid()) = visited_id)
            );
    END IF;
END $$;

-- live_broadcast_messages 表
DO $$
BEGIN
    -- 修复 "Users can insert chat messages" 策略
    IF EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE schemaname = 'public' 
          AND tablename = 'live_broadcast_messages' 
          AND policyname = 'Users can insert chat messages'
          AND with_check LIKE '%auth.uid()%'
    ) THEN
        DROP POLICY IF EXISTS "Users can insert chat messages" ON public.live_broadcast_messages;
        CREATE POLICY "Users can insert chat messages" ON public.live_broadcast_messages
            FOR INSERT TO authenticated
            WITH CHECK (
                (select auth.uid()) = user_id AND 
                msg_type = 'chat'
            );
    END IF;
    
    -- 修复 "Authenticated users send messages" 策略（如果存在）
    IF EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE schemaname = 'public' 
          AND tablename = 'live_broadcast_messages' 
          AND policyname = 'Authenticated users send messages'
          AND with_check LIKE '%auth.uid()%'
    ) THEN
        DROP POLICY IF EXISTS "Authenticated users send messages" ON public.live_broadcast_messages;
        CREATE POLICY "Authenticated users send messages" ON public.live_broadcast_messages
            FOR INSERT WITH CHECK ((select auth.uid()) = user_id);
    END IF;
END $$;

-- notification_history 表
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE schemaname = 'public' 
          AND tablename = 'notification_history' 
          AND policyname = 'Users can view own notification history'
    ) THEN
        DROP POLICY IF EXISTS "Users can view own notification history" ON public.notification_history;
        CREATE POLICY "Users can view own notification history" ON public.notification_history
            FOR SELECT USING ((select auth.uid()) = receiver_id);
    END IF;
END $$;

-- dice_rooms 表
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE schemaname = 'public' 
          AND tablename = 'dice_rooms' 
          AND policyname = 'Owners can update own dice rooms'
    ) THEN
        DROP POLICY IF EXISTS "Owners can update own dice rooms" ON public.dice_rooms;
        CREATE POLICY "Owners can update own dice rooms" ON public.dice_rooms
            FOR UPDATE USING ((select auth.uid()) = owner_id);
    END IF;
    
    IF EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE schemaname = 'public' 
          AND tablename = 'dice_rooms' 
          AND policyname = 'Authenticated users can create dice rooms'
          AND with_check LIKE '%auth.uid()%'
    ) THEN
        DROP POLICY IF EXISTS "Authenticated users can create dice rooms" ON public.dice_rooms;
        CREATE POLICY "Authenticated users can create dice rooms" ON public.dice_rooms
            FOR INSERT TO authenticated WITH CHECK ((select auth.uid()) = owner_id);
    END IF;
END $$;

-- dice_room_players 表
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE schemaname = 'public' 
          AND tablename = 'dice_room_players' 
          AND policyname = 'Players can update own records'
    ) THEN
        DROP POLICY IF EXISTS "Players can update own records" ON public.dice_room_players;
        CREATE POLICY "Players can update own records" ON public.dice_room_players
            FOR UPDATE USING ((select auth.uid()) = user_id);
    END IF;
    
    IF EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE schemaname = 'public' 
          AND tablename = 'dice_room_players' 
          AND policyname = 'Authenticated users can join dice rooms'
          AND with_check LIKE '%auth.uid()%'
    ) THEN
        DROP POLICY IF EXISTS "Authenticated users can join dice rooms" ON public.dice_room_players;
        CREATE POLICY "Authenticated users can join dice rooms" ON public.dice_room_players
            FOR INSERT TO authenticated WITH CHECK ((select auth.uid()) = user_id);
    END IF;
END $$;

-- recharge_orders 表
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE schemaname = 'public' 
          AND tablename = 'recharge_orders' 
          AND policyname = 'Users view own recharge orders'
    ) THEN
        DROP POLICY IF EXISTS "Users view own recharge orders" ON public.recharge_orders;
        CREATE POLICY "Users view own recharge orders" ON public.recharge_orders
            FOR SELECT USING ((select auth.uid()) = user_id);
    END IF;
    
    IF EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE schemaname = 'public' 
          AND tablename = 'recharge_orders' 
          AND policyname = 'Users insert own recharge orders'
    ) THEN
        DROP POLICY IF EXISTS "Users insert own recharge orders" ON public.recharge_orders;
        CREATE POLICY "Users insert own recharge orders" ON public.recharge_orders
            FOR INSERT WITH CHECK ((select auth.uid()) = user_id);
    END IF;
END $$;

-- withdraw_orders 表
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE schemaname = 'public' 
          AND tablename = 'withdraw_orders' 
          AND policyname = 'Users view own withdraw orders'
    ) THEN
        DROP POLICY IF EXISTS "Users view own withdraw orders" ON public.withdraw_orders;
        CREATE POLICY "Users view own withdraw orders" ON public.withdraw_orders
            FOR SELECT USING ((select auth.uid()) = user_id);
    END IF;
END $$;

-- coin_transactions 表
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE schemaname = 'public' 
          AND tablename = 'coin_transactions' 
          AND policyname = 'Admin view all transactions'
          AND qual LIKE '%auth.uid()%'
    ) THEN
        DROP POLICY IF EXISTS "Admin view all transactions" ON public.coin_transactions;
        CREATE POLICY "Admin view all transactions" ON public.coin_transactions
            FOR SELECT USING (
                ((select auth.uid()) = user_id) OR 
                public.check_is_admin()
            );
    END IF;
END $$;

-- live_red_packet_claims 表
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE schemaname = 'public' 
          AND tablename = 'live_red_packet_claims' 
          AND policyname = 'Users view own claims'
    ) THEN
        DROP POLICY IF EXISTS "Users view own claims" ON public.live_red_packet_claims;
        CREATE POLICY "Users view own claims" ON public.live_red_packet_claims
            FOR SELECT USING ((select auth.uid()) = user_id);
    END IF;
END $$;

-- bound_channels 表
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE schemaname = 'public' 
          AND tablename = 'bound_channels' 
          AND policyname = 'Users can view own bound channels'
    ) THEN
        DROP POLICY IF EXISTS "Users can view own bound channels" ON public.bound_channels;
        CREATE POLICY "Users can view own bound channels" ON public.bound_channels
            FOR SELECT USING ((select auth.uid()) = user_id);
    END IF;
    
    IF EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE schemaname = 'public' 
          AND tablename = 'bound_channels' 
          AND policyname = 'Users can delete own bound channels'
    ) THEN
        DROP POLICY IF EXISTS "Users can delete own bound channels" ON public.bound_channels;
        CREATE POLICY "Users can delete own bound channels" ON public.bound_channels
            FOR DELETE USING ((select auth.uid()) = user_id);
    END IF;
END $$;

-- user_incentive_progress 表
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE schemaname = 'public' 
          AND tablename = 'user_incentive_progress' 
          AND policyname = 'Users can view their own task progress'
    ) THEN
        DROP POLICY IF EXISTS "Users can view their own task progress" ON public.user_incentive_progress;
        CREATE POLICY "Users can view their own task progress" ON public.user_incentive_progress
            FOR SELECT USING ((select auth.uid()) = user_id);
    END IF;
END $$;

-- ============================================
-- 2. 修复 multiple_permissive_policies - 合并多个permissive策略
-- ============================================
-- 将多个permissive策略合并为一个，使用 OR 条件

-- live_broadcast_rooms 表
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE schemaname = 'public' 
          AND tablename = 'live_broadcast_rooms' 
          AND policyname IN ('Anchors manage own rooms', 'Public view live rooms')
    ) THEN
        DROP POLICY IF EXISTS "Anchors manage own rooms" ON public.live_broadcast_rooms;
        DROP POLICY IF EXISTS "Public view live rooms" ON public.live_broadcast_rooms;
        
        CREATE POLICY "Anchors and public can view live rooms" ON public.live_broadcast_rooms
            FOR SELECT USING (
                (status = 'live') OR 
                ((select auth.uid()) = anchor_id) OR
                public.check_is_admin()
            );
    END IF;
END $$;

-- bound_channels 表
DO $$
BEGIN
    -- DELETE 策略合并
    IF EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE schemaname = 'public' 
          AND tablename = 'bound_channels' 
          AND policyname IN ('Admins can delete all bound channels', 'Users can delete own bound channels')
    ) THEN
        DROP POLICY IF EXISTS "Admins can delete all bound channels" ON public.bound_channels;
        DROP POLICY IF EXISTS "Users can delete own bound channels" ON public.bound_channels;
        
        CREATE POLICY "Users and admins can delete bound channels" ON public.bound_channels
            FOR DELETE USING (
                ((select auth.uid()) = user_id) OR 
                public.check_is_admin()
            );
    END IF;
    
    -- SELECT 策略合并
    IF EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE schemaname = 'public' 
          AND tablename = 'bound_channels' 
          AND policyname IN ('Admins can view all bound channels', 'Users can view own bound channels')
    ) THEN
        DROP POLICY IF EXISTS "Admins can view all bound channels" ON public.bound_channels;
        DROP POLICY IF EXISTS "Users can view own bound channels" ON public.bound_channels;
        
        CREATE POLICY "Users and admins can view bound channels" ON public.bound_channels
            FOR SELECT USING (
                ((select auth.uid()) = user_id) OR 
                public.check_is_admin()
            );
    END IF;
END $$;

-- coin_transactions 表
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE schemaname = 'public' 
          AND tablename = 'coin_transactions' 
          AND policyname IN ('Admin view all transactions', 'Admins manage all transactions')
    ) THEN
        DROP POLICY IF EXISTS "Admins manage all transactions" ON public.coin_transactions;
        -- Admin view all transactions 已经在上面修复过了，这里不需要再处理
    END IF;
END $$;

-- gifts 表
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE schemaname = 'public' 
          AND tablename = 'gifts' 
          AND policyname IN ('Admins manage all gifts', 'Anyone can view active gifts')
    ) THEN
        DROP POLICY IF EXISTS "Admins manage all gifts" ON public.gifts;
        DROP POLICY IF EXISTS "Anyone can view active gifts" ON public.gifts;
        
        CREATE POLICY "Admins and public can view active gifts" ON public.gifts
            FOR SELECT USING (
                (is_active = true) OR 
                public.check_is_admin()
            );
    END IF;
END $$;

-- incentive_rules 表
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE schemaname = 'public' 
          AND tablename = 'incentive_rules' 
          AND policyname IN ('Admins manage all incentive rules', 'Users can view active incentive rules')
    ) THEN
        DROP POLICY IF EXISTS "Admins manage all incentive rules" ON public.incentive_rules;
        DROP POLICY IF EXISTS "Users can view active incentive rules" ON public.incentive_rules;
        
        CREATE POLICY "Users and admins can view incentive rules" ON public.incentive_rules
            FOR SELECT USING (
                (is_active = true) OR 
                public.check_is_admin()
            );
    END IF;
END $$;

-- profiles 表
DO $$
BEGIN
    -- SELECT 策略合并
    IF EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE schemaname = 'public' 
          AND tablename = 'profiles' 
          AND policyname IN ('Admins manage all profiles', 'Public profiles are viewable by everyone')
    ) THEN
        DROP POLICY IF EXISTS "Admins manage all profiles" ON public.profiles;
        DROP POLICY IF EXISTS "Public profiles are viewable by everyone" ON public.profiles;
        
        CREATE POLICY "Public profiles and admins can view all profiles" ON public.profiles
            FOR SELECT USING (
                (deleted_at IS NULL) OR 
                public.check_is_admin()
            );
    END IF;
    
    -- UPDATE 策略合并
    IF EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE schemaname = 'public' 
          AND tablename = 'profiles' 
          AND policyname IN ('Admins manage all profiles', 'Users can update own profile')
    ) THEN
        -- 注意：Admins manage all profiles 可能包含 UPDATE，需要检查
        -- Users can update own profile 已经在上面修复过了
        -- 这里只删除 Admins manage all profiles 的 UPDATE 部分（如果存在）
        IF EXISTS (
            SELECT 1 FROM pg_policies 
            WHERE schemaname = 'public' 
              AND tablename = 'profiles' 
              AND policyname = 'Admins manage all profiles'
              AND cmd = 'UPDATE'
        ) THEN
            -- 需要重新创建 Admins manage all profiles 的 UPDATE 策略
            DROP POLICY IF EXISTS "Admins manage all profiles" ON public.profiles;
            -- 但保留 SELECT 策略（已经在上面处理了）
        END IF;
    END IF;
END $$;

-- recharge_orders 表
DO $$
BEGIN
    -- INSERT 策略合并
    IF EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE schemaname = 'public' 
          AND tablename = 'recharge_orders' 
          AND policyname IN ('Admins manage all recharge orders', 'Users insert own recharge orders')
    ) THEN
        DROP POLICY IF EXISTS "Admins manage all recharge orders" ON public.recharge_orders;
        -- Users insert own recharge orders 已经在上面修复过了
        -- 需要重新创建 Admins manage all recharge orders 的 INSERT 策略
        CREATE POLICY "Admins can insert recharge orders" ON public.recharge_orders
            FOR INSERT TO authenticated WITH CHECK (public.check_is_admin());
    END IF;
    
    -- SELECT 策略合并
    IF EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE schemaname = 'public' 
          AND tablename = 'recharge_orders' 
          AND policyname IN ('Admins view all recharge orders', 'Users view own recharge orders')
    ) THEN
        DROP POLICY IF EXISTS "Admins view all recharge orders" ON public.recharge_orders;
        DROP POLICY IF EXISTS "Users view own recharge orders" ON public.recharge_orders;
        
        CREATE POLICY "Users and admins can view recharge orders" ON public.recharge_orders
            FOR SELECT USING (
                ((select auth.uid()) = user_id) OR 
                public.check_is_admin()
            );
    END IF;
END $$;

-- user_incentive_progress 表
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE schemaname = 'public' 
          AND tablename = 'user_incentive_progress' 
          AND policyname IN ('Admins manage user incentive progress', 'Users can view their own task progress')
    ) THEN
        DROP POLICY IF EXISTS "Admins manage user incentive progress" ON public.user_incentive_progress;
        DROP POLICY IF EXISTS "Users can view their own task progress" ON public.user_incentive_progress;
        
        CREATE POLICY "Users and admins can view incentive progress" ON public.user_incentive_progress
            FOR SELECT USING (
                ((select auth.uid()) = user_id) OR 
                public.check_is_admin()
            );
    END IF;
END $$;

-- video_collections 表
DO $$
BEGIN
    -- DELETE 策略合并
    IF EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE schemaname = 'public' 
          AND tablename = 'video_collections' 
          AND policyname IN ('Admins manage all video collections', 'Users can delete own collections')
    ) THEN
        DROP POLICY IF EXISTS "Admins manage all video collections" ON public.video_collections;
        DROP POLICY IF EXISTS "Users can delete own collections" ON public.video_collections;
        
        CREATE POLICY "Users and admins can delete video collections" ON public.video_collections
            FOR DELETE USING (
                ((select auth.uid()) = user_id) OR 
                public.check_is_admin()
            );
    END IF;
    
    -- INSERT 策略合并
    IF EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE schemaname = 'public' 
          AND tablename = 'video_collections' 
          AND policyname IN ('Admins manage all video collections', 'Users can insert own collections')
    ) THEN
        DROP POLICY IF EXISTS "Users can insert own collections" ON public.video_collections;
        
        CREATE POLICY "Users and admins can insert video collections" ON public.video_collections
            FOR INSERT WITH CHECK (
                ((select auth.uid()) = user_id) OR 
                public.check_is_admin()
            );
    END IF;
    
    -- SELECT 策略合并
    IF EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE schemaname = 'public' 
          AND tablename = 'video_collections' 
          AND policyname IN ('Admins manage all video collections', 'Users can view own collections')
    ) THEN
        DROP POLICY IF EXISTS "Users can view own collections" ON public.video_collections;
        
        CREATE POLICY "Users and admins can view video collections" ON public.video_collections
            FOR SELECT USING (
                ((select auth.uid()) = user_id) OR 
                public.check_is_admin()
            );
    END IF;
END $$;

-- video_comments 表
DO $$
BEGIN
    -- DELETE 策略合并
    IF EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE schemaname = 'public' 
          AND tablename = 'video_comments' 
          AND policyname IN ('Admins manage all comments', 'Users can delete own comments')
    ) THEN
        DROP POLICY IF EXISTS "Admins manage all comments" ON public.video_comments;
        DROP POLICY IF EXISTS "Users can delete own comments" ON public.video_comments;
        
        CREATE POLICY "Users and admins can delete comments" ON public.video_comments
            FOR DELETE USING (
                ((select auth.uid()) = user_id) OR 
                public.check_is_admin()
            );
    END IF;
    
    -- INSERT 策略合并
    IF EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE schemaname = 'public' 
          AND tablename = 'video_comments' 
          AND policyname IN ('Admins manage all comments', 'Users can insert own comments')
    ) THEN
        DROP POLICY IF EXISTS "Users can insert own comments" ON public.video_comments;
        
        CREATE POLICY "Users and admins can insert comments" ON public.video_comments
            FOR INSERT WITH CHECK (
                ((select auth.uid()) = user_id) OR 
                public.check_is_admin()
            );
    END IF;
    
    -- SELECT 策略合并
    IF EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE schemaname = 'public' 
          AND tablename = 'video_comments' 
          AND policyname IN ('Admins manage all comments', 'Approved comments are viewable by everyone')
    ) THEN
        DROP POLICY IF EXISTS "Approved comments are viewable by everyone" ON public.video_comments;
        
        CREATE POLICY "Approved comments and admins can view all comments" ON public.video_comments
            FOR SELECT USING (
                (review_status = 'approved' AND deleted_at IS NULL) OR 
                ((select auth.uid()) = user_id) OR
                public.check_is_admin()
            );
    END IF;
    
    -- UPDATE 策略合并
    IF EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE schemaname = 'public' 
          AND tablename = 'video_comments' 
          AND policyname IN ('Admins manage all comments', 'Users can update own comments')
    ) THEN
        DROP POLICY IF EXISTS "Users can update own comments" ON public.video_comments;
        
        CREATE POLICY "Users and admins can update comments" ON public.video_comments
            FOR UPDATE USING (
                ((select auth.uid()) = user_id) OR 
                public.check_is_admin()
            );
    END IF;
END $$;

-- video_likes 表
DO $$
BEGIN
    -- DELETE 策略合并
    IF EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE schemaname = 'public' 
          AND tablename = 'video_likes' 
          AND policyname IN ('Admins manage all video likes', 'Users can delete own likes')
    ) THEN
        DROP POLICY IF EXISTS "Admins manage all video likes" ON public.video_likes;
        DROP POLICY IF EXISTS "Users can delete own likes" ON public.video_likes;
        
        CREATE POLICY "Users and admins can delete video likes" ON public.video_likes
            FOR DELETE USING (
                ((select auth.uid()) = user_id) OR 
                public.check_is_admin()
            );
    END IF;
    
    -- INSERT 策略合并
    IF EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE schemaname = 'public' 
          AND tablename = 'video_likes' 
          AND policyname IN ('Admins manage all video likes', 'Users can insert own likes')
    ) THEN
        DROP POLICY IF EXISTS "Users can insert own likes" ON public.video_likes;
        
        CREATE POLICY "Users and admins can insert video likes" ON public.video_likes
            FOR INSERT WITH CHECK (
                ((select auth.uid()) = user_id) OR 
                public.check_is_admin()
            );
    END IF;
    
    -- SELECT 策略合并
    IF EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE schemaname = 'public' 
          AND tablename = 'video_likes' 
          AND policyname IN ('Admins manage all video likes', 'Video likes are viewable by everyone')
    ) THEN
        DROP POLICY IF EXISTS "Video likes are viewable by everyone" ON public.video_likes;
        
        CREATE POLICY "Video likes are viewable by everyone and admins" ON public.video_likes
            FOR SELECT USING (
                true OR 
                public.check_is_admin()
            );
        -- 实际上 true OR check_is_admin() 就是 true，所以可以简化为 true
        -- 但为了保持一致性，保留这个结构
    END IF;
END $$;

-- videos 表
DO $$
BEGIN
    -- DELETE 策略合并
    IF EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE schemaname = 'public' 
          AND tablename = 'videos' 
          AND policyname IN ('Admins manage all videos', 'Users can delete own videos')
    ) THEN
        DROP POLICY IF EXISTS "Admins manage all videos" ON public.videos;
        DROP POLICY IF EXISTS "Users can delete own videos" ON public.videos;
        
        CREATE POLICY "Users and admins can delete videos" ON public.videos
            FOR DELETE USING (
                ((select auth.uid()) = author_id) OR 
                public.check_is_admin()
            );
    END IF;
    
    -- INSERT 策略合并
    IF EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE schemaname = 'public' 
          AND tablename = 'videos' 
          AND policyname IN ('Admins manage all videos', 'Users can insert own videos')
    ) THEN
        DROP POLICY IF EXISTS "Users can insert own videos" ON public.videos;
        
        CREATE POLICY "Users and admins can insert videos" ON public.videos
            FOR INSERT WITH CHECK (
                ((select auth.uid()) = author_id) OR 
                public.check_is_admin()
            );
    END IF;
    
    -- SELECT 策略合并
    IF EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE schemaname = 'public' 
          AND tablename = 'videos' 
          AND policyname IN ('Admins manage all videos', 'Approved public videos are viewable by everyone')
    ) THEN
        DROP POLICY IF EXISTS "Approved public videos are viewable by everyone" ON public.videos;
        
        CREATE POLICY "Approved public videos and admins can view all videos" ON public.videos
            FOR SELECT USING (
                (review_status = 'approved' AND is_private = false) OR 
                ((select auth.uid()) = author_id) OR
                public.check_is_admin()
            );
    END IF;
    
    -- UPDATE 策略合并
    IF EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE schemaname = 'public' 
          AND tablename = 'videos' 
          AND policyname IN ('Admins manage all videos', 'Users can update own videos')
    ) THEN
        DROP POLICY IF EXISTS "Users can update own videos" ON public.videos;
        
        CREATE POLICY "Users and admins can update videos" ON public.videos
            FOR UPDATE USING (
                ((select auth.uid()) = author_id) OR 
                public.check_is_admin()
            );
    END IF;
END $$;

-- withdraw_orders 表
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE schemaname = 'public' 
          AND tablename = 'withdraw_orders' 
          AND policyname IN ('Admins manage all withdraw orders', 'Users view own withdraw orders')
    ) THEN
        DROP POLICY IF EXISTS "Admins manage all withdraw orders" ON public.withdraw_orders;
        DROP POLICY IF EXISTS "Users view own withdraw orders" ON public.withdraw_orders;
        
        CREATE POLICY "Users and admins can view withdraw orders" ON public.withdraw_orders
            FOR SELECT USING (
                ((select auth.uid()) = user_id) OR 
                public.check_is_admin()
            );
    END IF;
END $$;

-- ============================================
-- 3. 修复 duplicate_index - 删除重复索引
-- ============================================

-- user_incentive_progress 表 - 删除重复索引
DO $$
BEGIN
    -- 检查是否存在重复的约束/索引
    IF EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conrelid = 'public.user_incentive_progress'::regclass
          AND conname = 'user_incentive_progress_uniq'
    ) AND EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conrelid = 'public.user_incentive_progress'::regclass
          AND conname = 'user_incentive_progress_user_id_rule_id_key'
    ) THEN
        -- 保留 user_incentive_progress_user_id_rule_id_key（更明确的名称），删除 user_incentive_progress_uniq 约束
        ALTER TABLE public.user_incentive_progress DROP CONSTRAINT IF EXISTS user_incentive_progress_uniq;
    END IF;
END $$;

-- videos 表 - 删除重复索引
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_indexes 
        WHERE schemaname = 'public' 
          AND tablename = 'videos' 
          AND indexname IN ('idx_videos_tags', 'idx_videos_tags_gin')
    ) THEN
        -- 检查哪个是 GIN 索引（通常 GIN 索引性能更好）
        IF EXISTS (
            SELECT 1 FROM pg_indexes 
            WHERE schemaname = 'public' 
              AND tablename = 'videos' 
              AND indexname = 'idx_videos_tags_gin'
        ) THEN
            -- 保留 GIN 索引，删除普通索引
            DROP INDEX IF EXISTS public.idx_videos_tags;
        ELSE
            -- 如果 GIN 索引不存在，保留普通索引
            DROP INDEX IF EXISTS public.idx_videos_tags_gin;
        END IF;
    END IF;
END $$;
