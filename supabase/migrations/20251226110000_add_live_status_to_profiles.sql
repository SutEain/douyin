-- 为 profiles 表增加直播申请状态
-- 0: 未申请, 1: 申请中, 2: 已通过, 3: 已拒绝
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS live_status SMALLINT DEFAULT 0;

COMMENT ON COLUMN public.profiles.live_status IS '直播申请状态: 0=未申请, 1=申请中, 2=已通过, 3=已拒绝';

-- 只有通过审核的用户才能在 live_broadcast_rooms 中创建记录
DROP POLICY IF EXISTS "Anchors manage own rooms" ON public.live_broadcast_rooms;
CREATE POLICY "Anchors manage own rooms" ON public.live_broadcast_rooms 
FOR ALL USING (
  auth.uid() = anchor_id AND 
  EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE id = auth.uid() AND live_status = 2
  )
);

