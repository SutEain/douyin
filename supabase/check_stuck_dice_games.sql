-- 检查卡住的骰子游戏
-- 1. 检查状态为 waiting 但超时的游戏（30秒）
SELECT 
    id,
    group_id,
    status,
    current_count,
    target_count,
    bet_amount,
    created_at,
    updated_at,
    EXTRACT(EPOCH FROM (NOW() - created_at)) as age_seconds,
    CASE 
        WHEN status = 'waiting' AND created_at < NOW() - INTERVAL '30 seconds' THEN 'waiting_timeout'
        WHEN status = 'rolling' AND created_at < NOW() - INTERVAL '5 minutes' THEN 'rolling_timeout'
        ELSE 'normal'
    END as issue_type
FROM dice_rooms
WHERE status IN ('waiting', 'rolling')
    AND (
        (status = 'waiting' AND created_at < NOW() - INTERVAL '30 seconds')
        OR (status = 'rolling' AND created_at < NOW() - INTERVAL '5 minutes')
    )
ORDER BY created_at DESC;

-- 2. 检查所有未完成的游戏（用于统计）
SELECT 
    status,
    COUNT(*) as count,
    MIN(created_at) as oldest_game,
    MAX(created_at) as newest_game
FROM dice_rooms
WHERE status IN ('waiting', 'rolling')
GROUP BY status;

-- 3. 检查 rolling 状态的游戏详情
SELECT 
    dr.id,
    dr.group_id,
    dr.status,
    dr.current_count,
    dr.target_count,
    dr.bet_amount,
    dr.created_at,
    dr.updated_at,
    EXTRACT(EPOCH FROM (NOW() - dr.created_at)) as age_seconds,
    COUNT(drp.id) as player_count,
    STRING_AGG(p.nickname, ', ') as player_names
FROM dice_rooms dr
LEFT JOIN dice_room_players drp ON dr.id = drp.room_id
LEFT JOIN profiles p ON drp.user_id = p.id
WHERE dr.status = 'rolling'
GROUP BY dr.id, dr.group_id, dr.status, dr.current_count, dr.target_count, dr.bet_amount, dr.created_at, dr.updated_at
ORDER BY dr.created_at DESC;
