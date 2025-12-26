import os
import requests
import re

# 配置路径
txt_path = '/Users/eain/Downloads/default.txt'
base_dir = 'public/assets/gifts'
icon_dir = os.path.join(base_dir, 'icons')
effect_dir = os.path.join(base_dir, 'effects')

# 创建目录
os.makedirs(icon_dir, exist_ok=True)
os.makedirs(effect_dir, exist_ok=True)

def download_file(url, folder, filename):
    if not url or url == 'None': return
    path = os.path.join(folder, filename)
    if os.path.exists(path):
        print(f"跳过: {filename} (已存在)")
        return
    try:
        print(f"正在下载: {filename}...")
        r = requests.get(url, timeout=30)
        if r.status_code == 200:
            with open(path, 'wb') as f:
                f.write(r.content)
        else:
            print(f"下载失败: {url} (状态码: {r.status_code})")
    except Exception as e:
        print(f"错误: {filename} - {str(e)}")

def main():
    if not os.path.exists(txt_path):
        print(f"错误: 找不到文件 {txt_path}")
        return

    with open(txt_path, 'r', encoding='utf-8') as f:
        lines = f.readlines()

    # 跳过第一行表头
    for line in lines[1:]:
        # 使用正则表达式分割（匹配多个空格）
        parts = re.split(r'\s+', line.strip())
        if len(parts) < 2: continue
        
        name = parts[0]
        icon_url = parts[1]
        # 有些礼物可能没有特效链接
        effect_url = parts[2] if len(parts) > 2 else None

        # 清洗文件名（去除特殊字符）
        safe_name = re.sub(r'[\\/:*?"<>|]', '', name)

        # 下载图标 (PNG)
        if icon_url and icon_url.startswith('http'):
            ext = os.path.splitext(icon_url)[1] or '.png'
            download_file(icon_url, icon_dir, f"{safe_name}{ext}")

        # 下载特效 (MP4)
        if effect_url and effect_url.startswith('http'):
            ext = os.path.splitext(effect_url)[1] or '.mp4'
            download_file(effect_url, effect_dir, f"{safe_name}{ext}")

    print("\n✅ 所有素材处理完成！")

if __name__ == "__main__":
    main()