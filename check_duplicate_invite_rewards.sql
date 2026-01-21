-- 检查是否有重复的邀请奖励记录
-- 查找同一个用户在同一天对同一个被邀请人有多条奖励记录

SELECT 
    ct.user_id as 邀请人ID,
    p.nickname as 邀请人昵称,
    ct.related_id as 被邀请人ID,
    COUNT(*) as 重复次数,
    SUM(ct.amount) as 总奖励金额,
    ARRAY_AGG(ct.id ORDER BY ct.created_at) as 交易ID列表,
    ARRAY_AGG(ct.created_at ORDER BY ct.created_at) as 创建时间列表
FROM coin_transactions ct
JOIN profiles p ON p.id = ct.user_id
WHERE ct.type = 'reward'
  AND ct.description LIKE '%成功邀请新用户%'
  AND ct.related_id IS NOT NULL
GROUP BY ct.user_id, ct.related_id, DATE(ct.created_at)
HAVING COUNT(*) > 1
ORDER BY ct.created_at DESC
LIMIT 50;

-- 检查是否有重复的 invite_success_count 增加
-- 这个查询可以帮助发现是否有异常的用户邀请计数

SELECT 
    user_id,
    COUNT(*) as 交易次数,
    SUM(amount) as 总奖励,
    MIN(created_at) as 最早时间,
    MAX(created_at) as 最晚时间,
    related_id
FROM coin_transactions
WHERE type = 'reward'
  AND description LIKE '%成功邀请新用户%'
GROUP BY user_id, related_id
HAVING COUNT(*) > 1
ORDER BY created_at DESC;
