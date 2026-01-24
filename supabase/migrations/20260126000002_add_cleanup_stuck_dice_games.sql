-- 🎯 创建清理卡住骰子游戏的函数
-- 用于清理状态为 waiting 或 rolling 但超时的游戏

CREATE OR REPLACE FUNCTION public.cleanup_stuck_dice_games()
RETURNS TABLE(
    room_id UUID,
    group_id BIGINT,
    status TEXT,
    age_seconds NUMERIC,
    issue_type TEXT,
    refunded_count INT,
    total_refund NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_room RECORD;
    v_player RECORD;
    v_refund_count INT := 0;
    v_total_refund NUMERIC := 0;
    v_bet_amount NUMERIC;
    v_final_balance NUMERIC;
BEGIN
    -- 1. 清理 waiting 状态超时的游戏（30秒）
    FOR v_room IN (
        SELECT id, group_id, status, bet_amount, created_at,
               EXTRACT(EPOCH FROM (NOW() - created_at)) as age_seconds
        FROM dice_rooms
        WHERE status = 'waiting'
          AND created_at < NOW() - INTERVAL '30 seconds'
        FOR UPDATE SKIP LOCKED
    ) LOOP
        v_bet_amount := v_room.bet_amount;
        v_refund_count := 0;
        v_total_refund := 0;
        
        -- 更新房间状态
        UPDATE dice_rooms
        SET status = 'cancelled',
            updated_at = NOW()
        WHERE id = v_room.id;
        
        -- 退还所有玩家的钱
        FOR v_player IN (
            SELECT user_id FROM dice_room_players WHERE room_id = v_room.id
        ) LOOP
            UPDATE profiles
            SET balance_coins = balance_coins + v_bet_amount,
                updated_at = NOW()
            WHERE id = v_player.user_id
            RETURNING balance_coins INTO v_final_balance;
            
            INSERT INTO coin_transactions (
                user_id, amount, balance_after, type, description, related_id
            ) VALUES (
                v_player.user_id,
                v_bet_amount,
                v_final_balance,
                'dice_refund',
                format('骰子游戏超时自动退款: 房间 %s (waiting超时)', v_room.id),
                v_room.id
            );
            
            v_refund_count := v_refund_count + 1;
            v_total_refund := v_total_refund + v_bet_amount;
        END LOOP;
        
        -- 返回结果
        room_id := v_room.id;
        group_id := v_room.group_id;
        status := 'cancelled';
        age_seconds := v_room.age_seconds;
        issue_type := 'waiting_timeout';
        refunded_count := v_refund_count;
        total_refund := v_total_refund;
        RETURN NEXT;
    END LOOP;
    
    -- 2. 清理 rolling 状态超时的游戏（5分钟）
    FOR v_room IN (
        SELECT id, group_id, status, bet_amount, created_at,
               EXTRACT(EPOCH FROM (NOW() - created_at)) as age_seconds
        FROM dice_rooms
        WHERE status = 'rolling'
          AND created_at < NOW() - INTERVAL '5 minutes'
        FOR UPDATE SKIP LOCKED
    ) LOOP
        v_bet_amount := v_room.bet_amount;
        v_refund_count := 0;
        v_total_refund := 0;
        
        -- 更新房间状态
        UPDATE dice_rooms
        SET status = 'cancelled',
            updated_at = NOW()
        WHERE id = v_room.id;
        
        -- 退还所有玩家的钱
        FOR v_player IN (
            SELECT user_id FROM dice_room_players WHERE room_id = v_room.id
        ) LOOP
            UPDATE profiles
            SET balance_coins = balance_coins + v_bet_amount,
                updated_at = NOW()
            WHERE id = v_player.user_id
            RETURNING balance_coins INTO v_final_balance;
            
            INSERT INTO coin_transactions (
                user_id, amount, balance_after, type, description, related_id
            ) VALUES (
                v_player.user_id,
                v_bet_amount,
                v_final_balance,
                'dice_refund',
                format('骰子游戏超时自动退款: 房间 %s (rolling超时)', v_room.id),
                v_room.id
            );
            
            v_refund_count := v_refund_count + 1;
            v_total_refund := v_total_refund + v_bet_amount;
        END LOOP;
        
        -- 返回结果
        room_id := v_room.id;
        group_id := v_room.group_id;
        status := 'cancelled';
        age_seconds := v_room.age_seconds;
        issue_type := 'rolling_timeout';
        refunded_count := v_refund_count;
        total_refund := v_total_refund;
        RETURN NEXT;
    END LOOP;
    
    RETURN;
END;
$$;

GRANT EXECUTE ON FUNCTION public.cleanup_stuck_dice_games() TO service_role;

COMMENT ON FUNCTION public.cleanup_stuck_dice_games() IS '🎯 清理卡住的骰子游戏：清理 waiting 状态超过30秒或 rolling 状态超过5分钟的游戏，并自动退款';
