-- 🎯 更新组合玩法赔率：大单/小双改为4.2倍，大双/小单保持4.6倍

CREATE OR REPLACE FUNCTION public.get_pc28_platform_odds(
    p_bet_type TEXT,
    p_bet_value INT DEFAULT 0
) RETURNS NUMERIC
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
    v_odds NUMERIC;
BEGIN
    -- 平台统一赔率配置
    IF p_bet_type = 'big' OR p_bet_type = 'small' THEN
        v_odds := 2.0;
    ELSIF p_bet_type = 'odd' OR p_bet_type = 'even' THEN
        v_odds := 2.0;
    ELSIF p_bet_type = 'big_odd' THEN
        v_odds := 4.2; -- 大单：4.2倍
    ELSIF p_bet_type = 'big_even' THEN
        v_odds := 4.6; -- 大双：4.6倍
    ELSIF p_bet_type = 'small_odd' THEN
        v_odds := 4.6; -- 小单：4.6倍
    ELSIF p_bet_type = 'small_even' THEN
        v_odds := 4.2; -- 小双：4.2倍
    ELSIF p_bet_type = 'extreme_big' OR p_bet_type = 'extreme_small' THEN
        v_odds := 15.0;
    ELSIF p_bet_type = 'pair' THEN
        v_odds := 3.4;
    ELSIF p_bet_type = 'straight' THEN
        v_odds := 15.0;
    ELSIF p_bet_type = 'leopard' THEN
        v_odds := 80.0;
    ELSIF p_bet_type = 'single_point' THEN
        -- 点杀倍数
        CASE p_bet_value
            WHEN 0, 27 THEN v_odds := 888.0;
            WHEN 1, 26 THEN v_odds := 222.0;
            WHEN 2, 25 THEN v_odds := 123.0;
            WHEN 3, 24 THEN v_odds := 80.0;
            WHEN 4, 23 THEN v_odds := 48.0;
            WHEN 5, 22 THEN v_odds := 38.0;
            WHEN 6, 21 THEN v_odds := 28.0;
            WHEN 7, 20 THEN v_odds := 22.0;
            WHEN 8, 19 THEN v_odds := 18.0;
            WHEN 9, 18 THEN v_odds := 15.0;
            WHEN 10, 17 THEN v_odds := 14.0;
            WHEN 11, 16 THEN v_odds := 13.0;
            WHEN 12, 15 THEN v_odds := 12.0;
            WHEN 13, 14 THEN v_odds := 11.0;
            ELSE v_odds := NULL;
        END CASE;
    ELSE
        v_odds := NULL;
    END IF;
    
    RETURN v_odds;
END;
$$;

COMMENT ON FUNCTION public.get_pc28_platform_odds IS '平台统一PC28赔率配置函数：大单/小双4.2倍，大双/小单4.6倍';
