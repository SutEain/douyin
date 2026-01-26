-- 🚨 调整异常账号的任务进度：让他们需要再增加20万播放量才能领取下一次奖励
-- 账号：46920（z）、46919（7 7）、58749（格局）
-- 原因：这些账号通过刷播放量获得了大量奖励，需要"还债"

UPDATE public.user_incentive_progress uip
SET 
    progress_value = (
        SELECT COALESCE(SUM(view_count), 0) + 200000 
        FROM public.videos v
        WHERE v.author_id = uip.user_id AND v.status = 'published'
    ),
    updated_at = NOW()
WHERE uip.rule_id = (SELECT id FROM public.incentive_rules WHERE code = 'author_views_reward')
  AND uip.user_id IN (
      SELECT id FROM public.profiles WHERE numeric_id IN (46920, 46919, 58749)
  );

COMMENT ON FUNCTION public.claim_author_views_reward IS '已调整异常账号46920、46919、58749的任务进度，需要再增加20万播放量才能领取下一次奖励';
