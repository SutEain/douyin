-- 添加游戏名称字段到PC28游戏期数表
ALTER TABLE public.pc28_game_rounds 
ADD COLUMN IF NOT EXISTS game_name TEXT DEFAULT 'PC28';

-- 添加注释
COMMENT ON COLUMN public.pc28_game_rounds.game_name IS '游戏名称，如：PC28、北京快三、上海快三等';
