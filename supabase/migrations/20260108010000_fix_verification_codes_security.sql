-- 修复验证码表的安全问题

-- 1. 删除过于宽松的 RLS 策略
DROP POLICY IF EXISTS "Anyone can insert verification codes" ON public.verification_codes;
DROP POLICY IF EXISTS "Anyone can select verification codes" ON public.verification_codes;
DROP POLICY IF EXISTS "Anyone can update verification codes" ON public.verification_codes;

-- 2. 创建更严格的策略：只允许 service role 访问
-- 注意：service role 会绕过 RLS，但保留策略作为防御层和文档说明
CREATE POLICY "Service role can manage verification codes"
  ON public.verification_codes
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- 3. 创建速率限制表
CREATE TABLE IF NOT EXISTS public.verification_rate_limits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  identifier VARCHAR(255) NOT NULL, -- IP 地址或 tg_user_id
  type VARCHAR(20) NOT NULL, -- 'ip' 或 'tg_user_id'
  action VARCHAR(20) NOT NULL, -- 'generate' 或 'verify'
  attempt_count INTEGER DEFAULT 1,
  first_attempt_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  last_attempt_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  locked_until TIMESTAMP WITH TIME ZONE,
  UNIQUE(identifier, type, action)
);

CREATE INDEX IF NOT EXISTS idx_verification_rate_limits_identifier ON public.verification_rate_limits(identifier, type, action);
CREATE INDEX IF NOT EXISTS idx_verification_rate_limits_locked ON public.verification_rate_limits(locked_until) WHERE locked_until IS NOT NULL;

-- 启用 RLS
ALTER TABLE public.verification_rate_limits ENABLE ROW LEVEL SECURITY;

-- RLS 策略：只允许 service role 访问
CREATE POLICY "Service role can manage rate limits"
  ON public.verification_rate_limits
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- 4. 添加注释
COMMENT ON TABLE public.verification_rate_limits IS '验证码速率限制表';
COMMENT ON COLUMN public.verification_rate_limits.identifier IS '标识符：IP 地址或 tg_user_id';
COMMENT ON COLUMN public.verification_rate_limits.type IS '类型：ip 或 tg_user_id';
COMMENT ON COLUMN public.verification_rate_limits.action IS '操作类型：generate 或 verify';
COMMENT ON COLUMN public.verification_rate_limits.locked_until IS '锁定到期时间，NULL 表示未锁定';
