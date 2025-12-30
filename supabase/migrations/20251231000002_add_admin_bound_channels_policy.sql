-- 为管理员增加对 bound_channels 的访问权限

-- 1. 允许管理员查看所有绑定频道
CREATE POLICY "Admins can view all bound channels" ON public.bound_channels
    FOR SELECT TO authenticated USING (public.check_is_admin());

-- 2. 允许管理员更新绑定频道设置（如：开关同步、设置成人/东南亚标签）
CREATE POLICY "Admins can update all bound channels" ON public.bound_channels
    FOR UPDATE TO authenticated USING (public.check_is_admin());

-- 3. 允许管理员解绑频道
CREATE POLICY "Admins can delete all bound channels" ON public.bound_channels
    FOR DELETE TO authenticated USING (public.check_is_admin());

