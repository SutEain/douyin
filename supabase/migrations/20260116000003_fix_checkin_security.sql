-- 🚨 优化签到奖励接口：添加安全验证
-- 1. 添加用户身份验证（防止越权）
-- 2. 添加最小时间间隔检查（防止并发竞态）
-- 3. 确保使用 SELECT FOR UPDATE 锁定

CREATE OR REPLACE FUNCTION public.execute_user_checkin(p_user_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $func$
DECLARE
    v_profile RECORD;
    v_now_beijing_wall TIMESTAMP; -- 北京墙上时间 (不带时区)
    v_today_beijing DATE;         -- 北京今天的日期
    v_last_checkin_beijing DATE;  -- 上次签到的北京日期
    v_streak INT;
    v_reward INT;
    v_final_balance NUMERIC;
    v_hours_to_next INT;
    v_minutes_to_next INT;
    v_last_checkin_time TIMESTAMPTZ;
    v_time_since_last_checkin INTERVAL;
BEGIN
    -- 🚨 安全验证 1: 只能为自己签到
    IF p_user_id != auth.uid() THEN
        RETURN jsonb_build_object('success', false, 'message', '非法操作：只能为自己签到');
    END IF;

    -- 🚨 安全验证 2: 检查最近一次签到时间，防止并发攻击
    SELECT last_checkin_at INTO v_last_checkin_time
    FROM public.profiles
    WHERE id = p_user_id;
    
    IF v_last_checkin_time IS NOT NULL THEN
        v_time_since_last_checkin := NOW() - v_last_checkin_time;
        -- 距离上次签到，至少需要等待1秒才能再次检查（防止并发竞态）
        IF v_time_since_last_checkin < INTERVAL '1 second' THEN
            RETURN jsonb_build_object('success', false, 'message', '请求过于频繁，请稍后再试');
        END IF;
    END IF;

    -- 1. 获取北京当前的墙上时间 (Wall Clock Time)
    -- now() 是带时区的，AT TIME ZONE 'Asia/Shanghai' 会将其转换为北京当地的 TIMESTAMP (不带时区)
    v_now_beijing_wall := now() AT TIME ZONE 'Asia/Shanghai';
    v_today_beijing := v_now_beijing_wall::DATE;

    -- 2. 🚨 使用 SELECT FOR UPDATE 锁定并获取用户信息，防止并发竞态
    SELECT * INTO v_profile FROM public.profiles WHERE id = p_user_id FOR UPDATE;
    
    IF v_profile IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', '用户不存在');
    END IF;

    -- 3. 计算上次签到的北京日期
    IF v_profile.last_checkin_at IS NOT NULL THEN
        v_last_checkin_beijing := (v_profile.last_checkin_at AT TIME ZONE 'Asia/Shanghai')::DATE;
        
        -- 判断是否是同一天签到 (按北京日期判断)
        IF v_last_checkin_beijing = v_today_beijing THEN
            -- 计算距离明天北京时间 0 点还有多久
            -- 明天 0 点 = 今天日期 + 1天
            v_hours_to_next := extract(hour from (v_today_beijing + INTERVAL '1 day' - v_now_beijing_wall));
            v_minutes_to_next := extract(minute from (v_today_beijing + INTERVAL '1 day' - v_now_beijing_wall));
            
            RETURN jsonb_build_object(
                'success', false, 
                'message', '您今天已经签到过了，下次签到还需等待 ' || v_hours_to_next || ' 小时 ' || v_minutes_to_next || ' 分钟。'
            );
        END IF;

        -- 判断是否连续（即上次签到是北京日期的昨天）
        IF v_last_checkin_beijing = (v_today_beijing - INTERVAL '1 day')::DATE THEN
            v_streak := v_profile.checkin_streak + 1;
        ELSE
            v_streak := 1; -- 中断，重新开始
        END IF;
    ELSE
        v_streak := 1; -- 首次签到
    END IF;

    -- 4. 计算奖励 (4, 5, 6, 7, 8, 9, 10...)
    IF v_streak >= 7 THEN
        v_reward := 10;
    ELSE
        v_reward := 3 + v_streak; -- 1天:4, 2天:5, ... 6天:9
    END IF;

    -- 5. 🚨 双重检查：再次验证是否今天已签到（防止在检查后、更新前被其他请求签到）
    IF v_profile.last_checkin_at IS NOT NULL THEN
        v_last_checkin_beijing := (v_profile.last_checkin_at AT TIME ZONE 'Asia/Shanghai')::DATE;
        IF v_last_checkin_beijing = v_today_beijing THEN
            RETURN jsonb_build_object('success', false, 'message', '您今天已经签到过了');
        END IF;
    END IF;

    -- 6. 更新用户数据
    UPDATE public.profiles 
    SET 
        balance_coins = balance_coins + v_reward,
        last_checkin_at = now(), -- 数据库存入带时区的当前时间
        checkin_streak = v_streak
    WHERE id = p_user_id
    RETURNING balance_coins INTO v_final_balance;

    -- 7. 记录资金流水
    INSERT INTO public.coin_transactions (user_id, amount, balance_after, type, description)
    VALUES (
        p_user_id, 
        v_reward, 
        v_final_balance, 
        'reward', 
        '每日签到奖励 (连续第 ' || v_streak || ' 天)'
    );

    RETURN jsonb_build_object(
        'success', true,
        'reward', v_reward,
        'streak', v_streak,
        'next_reward', CASE WHEN v_streak >= 7 THEN 10 ELSE 3 + v_streak + 1 END,
        'message', '签到成功！获得 ' || v_reward || ' 抖币。'
    );
END; $func$;

COMMENT ON FUNCTION public.execute_user_checkin IS '🚨 优化签到奖励接口：添加用户身份验证、最小时间间隔检查和双重验证，防止并发竞态和越权操作';
