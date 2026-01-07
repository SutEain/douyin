-- 创建验证码表，用于 Web 端登录
CREATE TABLE IF NOT EXISTS public.verification_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(6) NOT NULL UNIQUE,
  tg_user_id BIGINT NOT NULL,
  tg_username VARCHAR(255),
  tg_first_name VARCHAR(255),
  tg_last_name VARCHAR(255),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  used_at TIMESTAMP WITH TIME ZONE,
  is_used BOOLEAN DEFAULT FALSE
);

-- 创建索引
CREATE INDEX IF NOT EXISTS idx_verification_codes_code ON public.verification_codes(code);
CREATE INDEX IF NOT EXISTS idx_verification_codes_tg_user_id ON public.verification_codes(tg_user_id);
CREATE INDEX IF NOT EXISTS idx_verification_codes_expires_at ON public.verification_codes(expires_at);
CREATE INDEX IF NOT EXISTS idx_verification_codes_is_used ON public.verification_codes(is_used);

-- 启用 RLS
ALTER TABLE public.verification_codes ENABLE ROW LEVEL SECURITY;

-- RLS 策略：任何人都可以创建验证码（由 Bot 创建）
CREATE POLICY "Anyone can insert verification codes"
  ON public.verification_codes
  FOR INSERT
  TO authenticated, anon
  WITH CHECK (true);

-- RLS 策略：任何人都可以查询验证码（用于验证）
CREATE POLICY "Anyone can select verification codes"
  ON public.verification_codes
  FOR SELECT
  TO authenticated, anon
  USING (true);

-- RLS 策略：任何人都可以更新验证码（标记为已使用）
CREATE POLICY "Anyone can update verification codes"
  ON public.verification_codes
  FOR UPDATE
  TO authenticated, anon
  USING (true)
  WITH CHECK (true);

-- 创建清理过期验证码的函数（可选，用于定期清理）
CREATE OR REPLACE FUNCTION public.cleanup_expired_verification_codes()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  DELETE FROM public.verification_codes
  WHERE expires_at < NOW() - INTERVAL '1 day';
END;
$$;

-- 添加注释
COMMENT ON TABLE public.verification_codes IS 'Web 端登录验证码表';
COMMENT ON COLUMN public.verification_codes.code IS '6 位数验证码';
COMMENT ON COLUMN public.verification_codes.tg_user_id IS 'Telegram 用户 ID';
COMMENT ON COLUMN public.verification_codes.expires_at IS '过期时间';
COMMENT ON COLUMN public.verification_codes.is_used IS '是否已使用';
