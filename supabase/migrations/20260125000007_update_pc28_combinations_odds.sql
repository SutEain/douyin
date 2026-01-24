-- 更新PC28组合赔率：大单、小单、大双、小双改为3.8

-- 更新所有主播的PC28配置中的组合赔率
UPDATE public.pc28_game_configs
SET game_settings = jsonb_set(
    jsonb_set(
        jsonb_set(
            jsonb_set(
                game_settings,
                '{combinations,big_odd}',
                '3.8'::jsonb
            ),
            '{combinations,big_even}',
            '3.8'::jsonb
        ),
        '{combinations,small_odd}',
        '3.8'::jsonb
    ),
    '{combinations,small_even}',
    '3.8'::jsonb
),
updated_at = now()
WHERE game_settings->'combinations'->>'enabled' = 'true'
  AND (
    (game_settings->'combinations'->>'big_odd')::numeric != 3.8 OR
    (game_settings->'combinations'->>'big_even')::numeric != 3.8 OR
    (game_settings->'combinations'->>'small_odd')::numeric != 3.8 OR
    (game_settings->'combinations'->>'small_even')::numeric != 3.8
  );

-- 更新默认配置（用于新创建的配置）
-- 注意：这不会影响已存在的配置，只是更新默认值
-- 如果需要更新默认值，需要修改创建表的迁移文件
