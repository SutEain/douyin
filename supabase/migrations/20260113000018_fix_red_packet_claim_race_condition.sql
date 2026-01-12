-- 修复抢红包并发竞争导致的重复领取错误 (unique_violation)
-- 核心逻辑：将 "是否已领过" 的检查移动到 FOR UPDATE 锁之后

CREATE OR REPLACE FUNCTION public.claim_live_red_packet(p_packet_id uuid, p_user_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_packet RECORD;
    v_claim_amount INT;
    v_already_claimed BOOLEAN;
    v_now TIMESTAMP WITH TIME ZONE := now();
    v_balance_after NUMERIC;
    v_sender_info RECORD;
BEGIN
    -- 1. 权限校验
    IF NOT (check_is_admin() OR p_user_id = auth.uid()) THEN 
        RAISE EXCEPTION 'Unauthorized'; 
    END IF;

    -- 2. 锁定红包行 (这是并发控制的关键)
    -- 注意：必须先锁定红包行，确保后续检查和扣减是原子的
    SELECT * INTO v_packet FROM public.live_red_packets WHERE id = p_packet_id FOR UPDATE;
    IF v_packet IS NULL THEN 
        RETURN json_build_object('success', false, 'message', '红包不存在'); 
    END IF;

    -- 3. 在锁内检查是否已经领过 (防止并发请求绕过检查)
    SELECT EXISTS (
        SELECT 1 FROM public.live_red_packet_claims 
        WHERE packet_id = p_packet_id AND user_id = p_user_id
    ) INTO v_already_claimed;
    
    IF v_already_claimed THEN 
        RETURN json_build_object('success', false, 'message', '您已经领过该红包了'); 
    END IF;

    -- 4. 获取发红包人的信息
    SELECT nickname, numeric_id INTO v_sender_info FROM public.profiles WHERE id = v_packet.sender_id;

    -- 5. 检查时间及状态
    IF v_packet.status = 'pending' AND v_now >= v_packet.unlock_at THEN
        UPDATE public.live_red_packets SET status = 'active' WHERE id = p_packet_id;
        v_packet.status := 'active';
    END IF;

    IF v_packet.status != 'active' THEN 
        RETURN json_build_object('success', false, 'message', '红包不在领取时间内或已结束'); 
    END IF;
    
    IF v_packet.remaining_count <= 0 THEN 
        RETURN json_build_object('success', false, 'message', '手慢了，红包领完了'); 
    END IF;

    -- 6. 计算领取金额
    IF v_packet.packet_type = 'equal' THEN
        v_claim_amount := floor(v_packet.total_coins / v_packet.total_count);
        IF v_packet.remaining_count = 1 THEN v_claim_amount := v_packet.remaining_coins; END IF;
    ELSE
        IF v_packet.remaining_count = 1 THEN
            v_claim_amount := v_packet.remaining_coins;
        ELSE
            DECLARE 
                v_max INT := (v_packet.remaining_coins / v_packet.remaining_count) * 2;
            BEGIN
                v_claim_amount := floor(random() * (v_max - 1) + 1);
                IF v_claim_amount >= v_packet.remaining_coins THEN 
                    v_claim_amount := v_packet.remaining_coins - (v_packet.remaining_count - 1); 
                END IF;
            END;
        END IF;
    END IF;
    
    IF v_claim_amount < 1 THEN v_claim_amount := 1; END IF;

    -- 7. 执行扣减和记录 (在同一个事务锁内)
    UPDATE public.live_red_packets 
    SET remaining_coins = remaining_coins - v_claim_amount, 
        remaining_count = remaining_count - 1, 
        status = CASE WHEN remaining_count - 1 = 0 THEN 'finished' ELSE 'active' END 
    WHERE id = p_packet_id;

    -- 8. 插入领取记录 (UNIQUE 约束会兜底)
    BEGIN
        INSERT INTO public.live_red_packet_claims (packet_id, user_id, amount) 
        VALUES (p_packet_id, p_user_id, v_claim_amount);
    EXCEPTION WHEN unique_violation THEN
        RETURN json_build_object('success', false, 'message', '您已经领过该红包了');
    END;

    -- 9. 更新用户余额并记录流水
    UPDATE public.profiles SET balance_coins = balance_coins + v_claim_amount 
    WHERE id = p_user_id 
    RETURNING balance_coins INTO v_balance_after;
    
    INSERT INTO public.coin_transactions (user_id, amount, balance_after, type, description, related_id, counterparty_id) 
    VALUES (
        p_user_id, v_claim_amount, v_balance_after, 'red_packet_claim', 
        '抢到来自 ' || v_sender_info.nickname || ' (ID: ' || v_sender_info.numeric_id || ') 的红包', 
        p_packet_id, v_packet.sender_id
    );

    RETURN json_build_object('success', true, 'amount', v_claim_amount);
END;
$function$
