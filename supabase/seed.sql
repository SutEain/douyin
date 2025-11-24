-- =====================================================
-- Douyin Database - Seed Data
-- =====================================================
-- This file contains sample data for development and testing

-- =====================================================
-- 1. TEST USERS
-- =====================================================
-- Note: Actual user creation should be done through Supabase Auth
-- These are profile extensions only

-- Insert test profiles (assuming auth.users already exist)
-- You'll need to create users through Supabase Dashboard or Auth API first

INSERT INTO public.profiles (id, username, nickname, bio, avatar_url, auth_provider, lang) VALUES
  ('00000000-0000-0000-0000-000000000001', 'alice', 'Alice Wang', '热爱生活，热爱分享 🎬', 'https://i.pravatar.cc/150?img=1', 'email', 'zh-CN'),
  ('00000000-0000-0000-0000-000000000002', 'bob', 'Bob Chen', '旅行博主 | 美食爱好者 🌍', 'https://i.pravatar.cc/150?img=2', 'email', 'zh-CN'),
  ('00000000-0000-0000-0000-000000000003', 'carol', 'Carol Li', '音乐制作人 🎵', 'https://i.pravatar.cc/150?img=3', 'email', 'en-US'),
  ('00000000-0000-0000-0000-000000000004', 'david', 'David Zhang', '科技数码评测 💻', 'https://i.pravatar.cc/150?img=4', 'email', 'zh-CN'),
  ('00000000-0000-0000-0000-000000000005', 'emma', 'Emma Liu', '健身教练 💪', 'https://i.pravatar.cc/150?img=5', 'email', 'zh-CN')
ON CONFLICT (id) DO NOTHING;

-- =====================================================
-- 2. TEST VIDEOS
-- =====================================================
INSERT INTO public.videos (
  id, 
  author_id, 
  title, 
  description, 
  play_url, 
  cover_url, 
  duration, 
  width, 
  height,
  review_status,
  transcode_status,
  tags,
  category,
  view_count,
  like_count,
  comment_count
) VALUES
  -- Alice's videos
  (
    '10000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000001',
    '城市夜景延时摄影',
    '用延时摄影记录城市的夜晚，感受时间的流动 🌃',
    'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
    'https://picsum.photos/720/1280?random=1',
    634,
    720,
    1280,
    'approved',
    'completed',
    ARRAY['摄影', '城市', '延时'],
    '摄影',
    15234,
    892,
    45
  ),
  (
    '10000000-0000-0000-0000-000000000002',
    '00000000-0000-0000-0000-000000000001',
    '咖啡拉花教程',
    '手把手教你做出完美的咖啡拉花 ☕️',
    'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4',
    'https://picsum.photos/720/1280?random=2',
    653,
    720,
    1280,
    'approved',
    'completed',
    ARRAY['教程', '咖啡', '生活'],
    '生活',
    8921,
    456,
    32
  ),
  
  -- Bob's videos
  (
    '10000000-0000-0000-0000-000000000003',
    '00000000-0000-0000-0000-000000000002',
    '成都美食探店 - 火锅篇',
    '带你吃遍成都最地道的火锅 🔥',
    'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4',
    'https://picsum.photos/720/1280?random=3',
    15,
    720,
    1280,
    'approved',
    'completed',
    ARRAY['美食', '成都', '火锅'],
    '美食',
    23456,
    1234,
    78
  ),
  (
    '10000000-0000-0000-0000-000000000004',
    '00000000-0000-0000-0000-000000000002',
    '西藏自驾游 Day 1',
    '开启西藏自驾之旅，第一站：拉萨 🚗',
    'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerEscapes.mp4',
    'https://picsum.photos/720/1280?random=4',
    15,
    720,
    1280,
    'approved',
    'completed',
    ARRAY['旅行', '西藏', 'Vlog'],
    '旅行',
    34567,
    2345,
    123
  ),
  
  -- Carol's videos
  (
    '10000000-0000-0000-0000-000000000005',
    '00000000-0000-0000-0000-000000000003',
    'Lofi Hip Hop Beat Making',
    'Creating a chill lofi beat from scratch 🎹',
    'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerFun.mp4',
    'https://picsum.photos/720/1280?random=5',
    60,
    720,
    1280,
    'approved',
    'completed',
    ARRAY['Music', 'Tutorial', 'Lofi'],
    '音乐',
    12345,
    678,
    34
  ),
  
  -- David's videos
  (
    '10000000-0000-0000-0000-000000000006',
    '00000000-0000-0000-0000-000000000004',
    'iPhone 15 Pro 深度评测',
    '全方位评测 iPhone 15 Pro，值得买吗？📱',
    'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerJoyrides.mp4',
    'https://picsum.photos/720/1280?random=6',
    15,
    720,
    1280,
    'approved',
    'completed',
    ARRAY['科技', '数码', '评测'],
    '科技',
    45678,
    3456,
    234
  ),
  
  -- Emma's videos
  (
    '10000000-0000-0000-0000-000000000007',
    '00000000-0000-0000-0000-000000000005',
    '10分钟燃脂训练',
    '在家就能做的高效燃脂训练，一起动起来！💪',
    'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerMeltdowns.mp4',
    'https://picsum.photos/720/1280?random=7',
    15,
    720,
    1280,
    'approved',
    'completed',
    ARRAY['健身', '教程', '燃脂'],
    '运动',
    56789,
    4567,
    345
  ),
  
  -- Private video example
  (
    '10000000-0000-0000-0000-000000000008',
    '00000000-0000-0000-0000-000000000001',
    '私密视频 - 仅自己可见',
    '这是一个私密视频',
    'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/Sintel.mp4',
    'https://picsum.photos/720/1280?random=8',
    888,
    720,
    1280,
    'approved',
    'completed',
    ARRAY['私密'],
    '其他',
    0,
    0,
    0
  )
ON CONFLICT (id) DO NOTHING;

-- Update is_private for the last video
UPDATE public.videos SET is_private = TRUE WHERE id = '10000000-0000-0000-0000-000000000008';

-- =====================================================
-- 3. FOLLOWS (Social Graph)
-- =====================================================
INSERT INTO public.follows (follower_id, followee_id) VALUES
  -- Alice follows Bob and Carol
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002'),
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000003'),
  
  -- Bob follows Alice and David
  ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000004'),
  
  -- Carol follows Alice
  ('00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000001'),
  
  -- David follows Bob and Emma
  ('00000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000002'),
  ('00000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000005'),
  
  -- Emma follows everyone
  ('00000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000002'),
  ('00000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000003'),
  ('00000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000004')
ON CONFLICT (follower_id, followee_id) DO NOTHING;

-- =====================================================
-- 4. VIDEO LIKES
-- =====================================================
INSERT INTO public.video_likes (user_id, video_id) VALUES
  -- Alice likes Bob's travel video
  ('00000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000004'),
  
  -- Bob likes Alice's videos
  ('00000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002'),
  
  -- Carol likes music and tech videos
  ('00000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000006'),
  
  -- David likes food videos
  ('00000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000003'),
  
  -- Emma likes fitness and lifestyle
  ('00000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000002'),
  ('00000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000007')
ON CONFLICT (user_id, video_id) DO NOTHING;

-- =====================================================
-- 5. VIDEO COMMENTS
-- =====================================================
INSERT INTO public.video_comments (id, video_id, user_id, content, review_status) VALUES
  (
    '20000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000002',
    '拍得太美了！请问用的什么相机？',
    'approved'
  ),
  (
    '20000000-0000-0000-0000-000000000002',
    '10000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000003',
    '这个角度绝了 👍',
    'approved'
  ),
  (
    '20000000-0000-0000-0000-000000000003',
    '10000000-0000-0000-0000-000000000003',
    '00000000-0000-0000-0000-000000000004',
    '看饿了，明天就去吃！',
    'approved'
  ),
  (
    '20000000-0000-0000-0000-000000000004',
    '10000000-0000-0000-0000-000000000006',
    '00000000-0000-0000-0000-000000000005',
    '评测很详细，准备入手了',
    'approved'
  ),
  -- Reply example
  (
    '20000000-0000-0000-0000-000000000005',
    '10000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000001',
    '谢谢！用的是 Sony A7M4',
    'approved'
  )
ON CONFLICT (id) DO NOTHING;

-- Set reply_to for the reply comment
UPDATE public.video_comments 
SET reply_to = '20000000-0000-0000-0000-000000000001'
WHERE id = '20000000-0000-0000-0000-000000000005';

-- =====================================================
-- 6. VIDEO COLLECTIONS
-- =====================================================
INSERT INTO public.video_collections (user_id, video_id) VALUES
  ('00000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000003'),
  ('00000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000005'),
  ('00000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000006'),
  ('00000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000003'),
  ('00000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000007')
ON CONFLICT (user_id, video_id) DO NOTHING;

-- =====================================================
-- 7. WATCH HISTORY
-- =====================================================
INSERT INTO public.watch_history (user_id, video_id, progress, completed) VALUES
  ('00000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000003', 180, false),
  ('00000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000004', 15, true),
  ('00000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 634, true),
  ('00000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000006', 300, false),
  ('00000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000003', 15, true),
  ('00000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000007', 450, false)
ON CONFLICT (user_id, video_id) DO UPDATE SET
  progress = EXCLUDED.progress,
  completed = EXCLUDED.completed,
  updated_at = NOW();

-- =====================================================
-- 8. NOTIFICATIONS
-- =====================================================
INSERT INTO public.notifications (user_id, type, title, content, payload, link_url) VALUES
  (
    '00000000-0000-0000-0000-000000000001',
    'like',
    '新的点赞',
    'Bob 赞了你的视频',
    '{"video_id": "10000000-0000-0000-0000-000000000001", "user_id": "00000000-0000-0000-0000-000000000002"}'::jsonb,
    '/video/10000000-0000-0000-0000-000000000001'
  ),
  (
    '00000000-0000-0000-0000-000000000001',
    'comment',
    '新的评论',
    'Bob 评论了你的视频：拍得太美了！',
    '{"video_id": "10000000-0000-0000-0000-000000000001", "comment_id": "20000000-0000-0000-0000-000000000001"}'::jsonb,
    '/video/10000000-0000-0000-0000-000000000001'
  ),
  (
    '00000000-0000-0000-0000-000000000001',
    'follow',
    '新的关注',
    'Emma 关注了你',
    '{"user_id": "00000000-0000-0000-0000-000000000005"}'::jsonb,
    '/user/00000000-0000-0000-0000-000000000005'
  ),
  (
    '00000000-0000-0000-0000-000000000002',
    'system',
    '系统通知',
    '欢迎使用抖音！',
    '{}'::jsonb,
    NULL
  )
ON CONFLICT DO NOTHING;

-- Mark some notifications as read
UPDATE public.notifications 
SET read_at = NOW() 
WHERE user_id = '00000000-0000-0000-0000-000000000001' 
AND type = 'system';

-- =====================================================
-- VERIFICATION QUERIES
-- =====================================================
-- Uncomment to run verification

-- SELECT 'Profiles count:', COUNT(*) FROM public.profiles;
-- SELECT 'Videos count:', COUNT(*) FROM public.videos;
-- SELECT 'Follows count:', COUNT(*) FROM public.follows;
-- SELECT 'Likes count:', COUNT(*) FROM public.video_likes;
-- SELECT 'Comments count:', COUNT(*) FROM public.video_comments;
-- SELECT 'Collections count:', COUNT(*) FROM public.video_collections;
-- SELECT 'Watch history count:', COUNT(*) FROM public.watch_history;
-- SELECT 'Notifications count:', COUNT(*) FROM public.notifications;
