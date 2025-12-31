-- Add system settings for automatic withdrawal
INSERT INTO public.system_settings (id, value_text) 
VALUES 
('withdraw_trc20_address', 'TKcxxG7gqTkhj6CTpZLVaQH8NNgnvwbZjg'),
('withdraw_trc20_private_key', '')
ON CONFLICT (id) DO NOTHING;

-- Add tx_hash field to track blockchain transactions
ALTER TABLE public.withdraw_orders ADD COLUMN IF NOT EXISTS tx_hash TEXT;

