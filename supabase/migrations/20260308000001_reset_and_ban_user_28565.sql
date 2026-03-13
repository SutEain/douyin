-- 用户 28565：余额归零、封禁，并重置被篡改的统计（视频数/粉丝数/赞数）。不写流水。

ALTER TABLE public.profiles DISABLE TRIGGER trigger_protect_sensitive_profile_fields;

UPDATE public.profiles
SET
    balance_coins = 0,
    frozen_coins = 0,
    is_banned = true,
    ban_reason = '违规处理：余额归零并封禁',
    video_count = 0,
    follower_count = 0,
    following_count = 0,
    total_likes = 0,
    updated_at = NOW()
WHERE numeric_id = 28565;

ALTER TABLE public.profiles ENABLE TRIGGER trigger_protect_sensitive_profile_fields;
