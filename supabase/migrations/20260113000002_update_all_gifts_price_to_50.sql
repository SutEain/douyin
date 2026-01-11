-- 🎁 将所有礼物价格统一改为50抖币，并全部启用

UPDATE public.gifts
SET 
  price = 50,
  is_active = true
WHERE price != 50 OR is_active != true;

-- 🎯 记录更新结果
DO $$
DECLARE
  v_updated_count INT;
BEGIN
  GET DIAGNOSTICS v_updated_count = ROW_COUNT;
  RAISE NOTICE '已更新 % 条礼物记录，价格统一为50抖币，全部启用', v_updated_count;
END $$;

