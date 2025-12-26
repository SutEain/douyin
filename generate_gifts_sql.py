import re
import random
import os

# 配置路径
txt_path = '/Users/eain/Downloads/default.txt'
sql_path = 'supabase/migrations/20251227150000_create_gifts_table.sql'

def main():
    if not os.path.exists(txt_path):
        print(f"错误: 找不到文件 {txt_path}")
        return

    with open(txt_path, 'r', encoding='utf-8') as f:
        lines = f.readlines()

    sql_header = """-- 1. 创建礼物表
CREATE TABLE IF NOT EXISTS public.gifts (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    price INT NOT NULL,
    sort_order INT NOT NULL DEFAULT 0,
    icon_filename TEXT NOT NULL,
    effect_filename TEXT,
    has_effect BOOLEAN DEFAULT TRUE,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. 开启 RLS
ALTER TABLE public.gifts ENABLE ROW LEVEL SECURITY;

-- 3. 所有人可见
DROP POLICY IF EXISTS "Anyone can view active gifts" ON public.gifts;
CREATE POLICY "Anyone can view active gifts" ON public.gifts
    FOR SELECT USING (is_active = true);

-- 4. 管理员全权限
DROP POLICY IF EXISTS "Admin manage gifts" ON public.gifts;
CREATE POLICY "Admin manage gifts" ON public.gifts
    FOR ALL TO authenticated
    USING (
        ((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = 'admin'
    )
    WITH CHECK (
        ((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = 'admin'
    );

-- 5. 插入数据
"""

    insert_values = []
    seen_names = set()
    
    count = 0
    for line in lines[1:]:
        parts = re.split(r'\s+', line.strip())
        if len(parts) < 3: continue
        
        name = parts[0]
        if name in seen_names:
            print(f"⚠️ 跳过重复礼物: {name}")
            continue
        
        seen_names.add(name)
        
        icon_url = parts[1]
        effect_url = parts[2]
        
        if not effect_url.startswith('http'): continue
        
        safe_name = re.sub(r'[\\/:*?"<>|]', '', name)
        price = random.randrange(10, 20001, 10) 
        count += 1
        sort_order = count
        
        icon_filename = f"{safe_name}.png"
        effect_filename = f"{safe_name}.mp4"
        escaped_name = name.replace("'", "''")
        
        insert_values.append(
            f"('{escaped_name}', {price}, {sort_order}, '{icon_filename}', '{effect_filename}', TRUE)"
        )

    # 批量插入 SQL
    sql_inserts = "INSERT INTO public.gifts (name, price, sort_order, icon_filename, effect_filename, has_effect) VALUES\n"
    sql_inserts += ",\n".join(insert_values)
    sql_inserts += " ON CONFLICT (name) DO UPDATE SET price = EXCLUDED.price, sort_order = EXCLUDED.sort_order, icon_filename = EXCLUDED.icon_filename, effect_filename = EXCLUDED.effect_filename;"

    with open(sql_path, 'w', encoding='utf-8') as f:
        f.write(sql_header)
        f.write(sql_inserts)

    print(f"✅ SQL 迁移文件已重新生成 (已去重): {sql_path}")
    print(f"📊 最终礼物数: {count}")

if __name__ == "__main__":
    main()
