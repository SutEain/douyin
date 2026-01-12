-- 修复 handle_new_user 触发器函数，处理唯一约束冲突
-- 问题：当创建 auth 用户时，触发器自动创建 profile，但如果 username 已存在或 profile 已存在，会导致唯一约束冲突
-- 解决方案：使用 ON CONFLICT 处理冲突，如果 profile 已存在则跳过，如果 username 冲突则生成唯一 username

CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  base_username TEXT;
  unique_username TEXT;
  counter INTEGER := 0;
BEGIN
  -- 如果 profile 已存在，直接返回（避免 id 冲突）
  IF EXISTS (SELECT 1 FROM public.profiles WHERE id = NEW.id) THEN
    RETURN NEW;
  END IF;

  -- 生成基础 username
  base_username := COALESCE(NEW.raw_user_meta_data->>'username', 'user_' || substr(NEW.id::text, 1, 8));
  unique_username := base_username;

  -- 如果 username 已存在，生成唯一的 username
  WHILE EXISTS (SELECT 1 FROM public.profiles WHERE username = unique_username AND id != NEW.id) LOOP
    counter := counter + 1;
    unique_username := base_username || '_' || counter::TEXT;
    -- 防止无限循环（理论上不会发生，但安全起见）
    IF counter > 1000 THEN
      unique_username := 'user_' || substr(NEW.id::text, 1, 8) || '_' || extract(epoch from now())::bigint::text;
      EXIT;
    END IF;
  END LOOP;

  -- 插入 profile
  -- 注意：如果仍然有冲突（例如并发插入），异常处理会捕获它
  INSERT INTO public.profiles (id, username, email_verified)
  VALUES (
    NEW.id,
    unique_username,
    NEW.email_confirmed_at IS NOT NULL
  );

  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    -- 如果仍然出错，记录错误但不阻止用户创建
    -- 注意：在生产环境中，你可能想要记录这个错误到日志表
    RAISE WARNING 'handle_new_user failed for user %: %', NEW.id, SQLERRM;
    RETURN NEW;
END;
$$;

