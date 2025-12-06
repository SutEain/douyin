# Railway Telethon 大文件处理服务

## 📋 项目概述

为了支持 > 19.8 MB 的大视频上传，需要部署一个独立的 Python 服务到 Railway，使用 Telethon 库通过 Telegram MTProto API 下载大文件（最大支持 2GB），然后上传到 Cloudflare R2 存储。

---

## 🎯 功能说明

### 处理流程

```
用户上传大视频 (> 19.8 MB)
    ↓
Bot 标记为 status = 'processing'
    ↓
Railway 服务检测到新视频
    ↓
通过 Telethon 下载大文件
    ↓
上传到 Cloudflare R2
    ↓
更新数据库 status = 'ready'
    ↓
通知用户"视频已就绪"
```

### 为什么需要 Railway？

1. **Telegram Bot API 限制**：`getFile` 方法最大 20 MB
2. **Telethon MTProto API**：支持最大 2 GB 文件
3. **长时间运行**：需要持续监听数据库，不适合 Serverless

---

## 🛠️ 技术栈

- **语言**：Python 3.11+
- **核心库**：
  - `telethon` - Telegram MTProto 客户端
  - `boto3` - AWS S3 兼容的 R2 上传
  - `supabase-py` - 数据库操作
  - `asyncio` - 异步处理
- **部署平台**：Railway (或 Fly.io / Render)
- **存储**：Cloudflare R2

---

## 📦 项目结构

```
railway-video-processor/
├── main.py                 # 主服务入口
├── requirements.txt        # Python 依赖
├── config.py              # 配置管理
├── telethon_client.py     # Telethon 客户端封装
├── r2_uploader.py         # R2 上传器
├── database.py            # Supabase 数据库操作
├── logger.py              # 日志配置
├── Dockerfile             # Railway 部署用（可选）
├── railway.json           # Railway 配置
└── README.md              # 项目说明
```

---

## 🔧 环境变量

需要在 Railway 设置以下环境变量：

```bash
# Telegram 配置
TG_API_ID=你的API_ID                    # 从 https://my.telegram.org 获取
TG_API_HASH=你的API_HASH                # 从 https://my.telegram.org 获取
TG_BOT_TOKEN=你的机器人TOKEN            # 与 Bot Function 相同

# Supabase 配置
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_KEY=你的服务密钥       # 需要 service_role 权限

# Cloudflare R2 配置
R2_ACCOUNT_ID=你的账户ID
R2_ACCESS_KEY_ID=你的Access_Key
R2_SECRET_ACCESS_KEY=你的Secret_Key
R2_BUCKET_NAME=douyin-videos            # R2 存储桶名称
R2_PUBLIC_URL=https://cdn.example.com   # R2 公开访问域名

# 服务配置
POLL_INTERVAL=10                         # 检查数据库间隔（秒）
MAX_CONCURRENT=3                         # 最大并发处理数
RETRY_LIMIT=3                            # 最大重试次数
```

---

## 📝 实现步骤

### Step 1: 创建项目目录

```bash
mkdir railway-video-processor
cd railway-video-processor
```

### Step 2: `requirements.txt`

```txt
telethon>=1.35.0
supabase>=2.3.0
boto3>=1.34.0
python-dotenv>=1.0.0
aiofiles>=23.2.1
```

### Step 3: `config.py`

```python
import os
from dotenv import load_dotenv

load_dotenv()

# Telegram 配置
TG_API_ID = int(os.getenv('TG_API_ID'))
TG_API_HASH = os.getenv('TG_API_HASH')
TG_BOT_TOKEN = os.getenv('TG_BOT_TOKEN')

# Supabase 配置
SUPABASE_URL = os.getenv('SUPABASE_URL')
SUPABASE_SERVICE_KEY = os.getenv('SUPABASE_SERVICE_KEY')

# R2 配置
R2_ACCOUNT_ID = os.getenv('R2_ACCOUNT_ID')
R2_ACCESS_KEY_ID = os.getenv('R2_ACCESS_KEY_ID')
R2_SECRET_ACCESS_KEY = os.getenv('R2_SECRET_ACCESS_KEY')
R2_BUCKET_NAME = os.getenv('R2_BUCKET_NAME', 'douyin-videos')
R2_PUBLIC_URL = os.getenv('R2_PUBLIC_URL')

# 服务配置
POLL_INTERVAL = int(os.getenv('POLL_INTERVAL', 10))
MAX_CONCURRENT = int(os.getenv('MAX_CONCURRENT', 3))
RETRY_LIMIT = int(os.getenv('RETRY_LIMIT', 3))
```

### Step 4: `logger.py`

```python
import logging
import sys

def setup_logger():
    logger = logging.getLogger('video_processor')
    logger.setLevel(logging.INFO)
    
    handler = logging.StreamHandler(sys.stdout)
    formatter = logging.Formatter(
        '%(asctime)s - %(name)s - %(levelname)s - %(message)s'
    )
    handler.setFormatter(formatter)
    logger.addHandler(handler)
    
    return logger

logger = setup_logger()
```

### Step 5: `telethon_client.py`

```python
from telethon import TelegramClient
import config
from logger import logger
import asyncio

class TelethonDownloader:
    def __init__(self):
        self.client = TelegramClient(
            'bot_session',
            config.TG_API_ID,
            config.TG_API_HASH
        )
    
    async def start(self):
        """启动 Telethon 客户端"""
        await self.client.start(bot_token=config.TG_BOT_TOKEN)
        logger.info("Telethon 客户端已启动")
    
    async def download_video(self, file_id: str, output_path: str) -> bool:
        """
        下载视频文件
        
        Args:
            file_id: Telegram 文件 ID
            output_path: 本地保存路径
        
        Returns:
            bool: 下载是否成功
        """
        try:
            logger.info(f"开始下载文件: {file_id}")
            
            # 通过 file_id 获取消息
            # 注意：这里需要根据实际情况调整，可能需要先通过 Bot API 获取消息信息
            # 然后使用 Telethon 下载
            
            # 方案：让 Bot 在插入数据库时，额外存储 message_id 和 chat_id
            # 这样 Railway 可以直接通过这两个 ID 获取消息并下载
            
            await self.client.download_media(
                message=file_id,  # 或者使用 message_id 和 chat_id
                file=output_path
            )
            
            logger.info(f"文件下载完成: {output_path}")
            return True
            
        except Exception as e:
            logger.error(f"下载文件失败: {e}")
            return False
    
    async def stop(self):
        """停止客户端"""
        await self.client.disconnect()
        logger.info("Telethon 客户端已断开")
```

### Step 6: `r2_uploader.py`

```python
import boto3
from botocore.config import Config
import config
from logger import logger
import os

class R2Uploader:
    def __init__(self):
        # R2 兼容 S3 API
        self.s3_client = boto3.client(
            's3',
            endpoint_url=f'https://{config.R2_ACCOUNT_ID}.r2.cloudflarestorage.com',
            aws_access_key_id=config.R2_ACCESS_KEY_ID,
            aws_secret_access_key=config.R2_SECRET_ACCESS_KEY,
            config=Config(signature_version='s3v4')
        )
        self.bucket_name = config.R2_BUCKET_NAME
    
    def upload_file(self, local_path: str, remote_key: str) -> str:
        """
        上传文件到 R2
        
        Args:
            local_path: 本地文件路径
            remote_key: R2 存储的键名（如 videos/abc123.mp4）
        
        Returns:
            str: 文件的公开访问 URL
        """
        try:
            logger.info(f"开始上传到 R2: {remote_key}")
            
            # 上传文件
            self.s3_client.upload_file(
                local_path,
                self.bucket_name,
                remote_key,
                ExtraArgs={
                    'ContentType': 'video/mp4',
                    'CacheControl': 'public, max-age=31536000'  # 缓存 1 年
                }
            )
            
            # 生成公开 URL
            public_url = f"{config.R2_PUBLIC_URL}/{remote_key}"
            
            logger.info(f"上传完成: {public_url}")
            return public_url
            
        except Exception as e:
            logger.error(f"上传失败: {e}")
            raise
    
    def delete_local_file(self, local_path: str):
        """删除本地临时文件"""
        try:
            if os.path.exists(local_path):
                os.remove(local_path)
                logger.info(f"已删除临时文件: {local_path}")
        except Exception as e:
            logger.warning(f"删除临时文件失败: {e}")
```

### Step 7: `database.py`

```python
from supabase import create_client, Client
import config
from logger import logger
from typing import List, Dict

class Database:
    def __init__(self):
        self.client: Client = create_client(
            config.SUPABASE_URL,
            config.SUPABASE_SERVICE_KEY
        )
    
    def get_processing_videos(self) -> List[Dict]:
        """获取所有 status = 'processing' 的视频"""
        try:
            response = self.client.table('videos') \
                .select('*') \
                .eq('status', 'processing') \
                .order('created_at', desc=False) \
                .execute()
            
            return response.data
        except Exception as e:
            logger.error(f"查询数据库失败: {e}")
            return []
    
    def update_video_ready(self, video_id: str, play_url: str, cover_url: str):
        """更新视频状态为 ready"""
        try:
            self.client.table('videos') \
                .update({
                    'status': 'ready',
                    'play_url': play_url,
                    'cover_url': cover_url,
                    'storage_type': 'r2'
                }) \
                .eq('id', video_id) \
                .execute()
            
            logger.info(f"视频状态已更新为 ready: {video_id}")
        except Exception as e:
            logger.error(f"更新数据库失败: {e}")
            raise
    
    def update_video_failed(self, video_id: str, error_msg: str):
        """更新视频状态为 failed"""
        try:
            self.client.table('videos') \
                .update({
                    'status': 'failed'
                }) \
                .eq('id', video_id) \
                .execute()
            
            logger.error(f"视频处理失败，已标记: {video_id}, 错误: {error_msg}")
        except Exception as e:
            logger.error(f"更新失败状态失败: {e}")
```

### Step 8: `main.py`

```python
import asyncio
from telethon_client import TelethonDownloader
from r2_uploader import R2Uploader
from database import Database
from logger import logger
import config
import uuid
import os

class VideoProcessor:
    def __init__(self):
        self.telethon = TelethonDownloader()
        self.r2 = R2Uploader()
        self.db = Database()
        self.processing = set()  # 正在处理的视频 ID
    
    async def start(self):
        """启动服务"""
        logger.info("🚀 Railway 视频处理服务启动中...")
        
        # 启动 Telethon 客户端
        await self.telethon.start()
        
        logger.info(f"⏰ 轮询间隔: {config.POLL_INTERVAL} 秒")
        logger.info(f"🔄 最大并发: {config.MAX_CONCURRENT}")
        
        # 主循环
        while True:
            try:
                await self.process_pending_videos()
                await asyncio.sleep(config.POLL_INTERVAL)
            except Exception as e:
                logger.error(f"主循环错误: {e}")
                await asyncio.sleep(5)
    
    async def process_pending_videos(self):
        """处理待处理的视频"""
        # 获取所有 processing 状态的视频
        videos = self.db.get_processing_videos()
        
        if not videos:
            return
        
        logger.info(f"📋 发现 {len(videos)} 个待处理视频")
        
        # 创建任务列表
        tasks = []
        for video in videos:
            video_id = video['id']
            
            # 跳过正在处理的视频
            if video_id in self.processing:
                continue
            
            # 限制并发数
            if len(self.processing) >= config.MAX_CONCURRENT:
                break
            
            # 添加到处理队列
            self.processing.add(video_id)
            task = asyncio.create_task(self.process_video(video))
            tasks.append(task)
        
        # 等待所有任务完成
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)
    
    async def process_video(self, video: dict):
        """处理单个视频"""
        video_id = video['id']
        tg_file_id = video['tg_file_id']
        tg_thumbnail_file_id = video.get('tg_thumbnail_file_id')
        
        try:
            logger.info(f"▶️  开始处理视频: {video_id}")
            
            # 1. 下载视频
            video_filename = f"{uuid.uuid4()}.mp4"
            video_path = f"/tmp/{video_filename}"
            
            success = await self.telethon.download_video(tg_file_id, video_path)
            if not success:
                raise Exception("视频下载失败")
            
            # 2. 上传视频到 R2
            video_key = f"videos/{video_filename}"
            video_url = self.r2.upload_file(video_path, video_key)
            
            # 3. 下载并上传缩略图（如果有）
            cover_url = ""
            if tg_thumbnail_file_id:
                thumb_filename = f"{uuid.uuid4()}.jpg"
                thumb_path = f"/tmp/{thumb_filename}"
                
                if await self.telethon.download_video(tg_thumbnail_file_id, thumb_path):
                    thumb_key = f"covers/{thumb_filename}"
                    cover_url = self.r2.upload_file(thumb_path, thumb_key)
                    self.r2.delete_local_file(thumb_path)
            
            # 4. 更新数据库
            self.db.update_video_ready(video_id, video_url, cover_url)
            
            # 5. 清理临时文件
            self.r2.delete_local_file(video_path)
            
            # 6. 通知用户（可选）
            # await self.notify_user(video['tg_user_id'], video_id)
            
            logger.info(f"✅ 视频处理完成: {video_id}")
            
        except Exception as e:
            logger.error(f"❌ 视频处理失败: {video_id}, 错误: {e}")
            self.db.update_video_failed(video_id, str(e))
        
        finally:
            # 从处理队列中移除
            self.processing.discard(video_id)
    
    async def stop(self):
        """停止服务"""
        logger.info("停止服务中...")
        await self.telethon.stop()

# 主入口
async def main():
    processor = VideoProcessor()
    try:
        await processor.start()
    except KeyboardInterrupt:
        logger.info("收到停止信号")
        await processor.stop()

if __name__ == '__main__':
    asyncio.run(main())
```

### Step 9: `railway.json`

```json
{
  "$schema": "https://railway.app/railway.schema.json",
  "build": {
    "builder": "NIXPACKS"
  },
  "deploy": {
    "startCommand": "python main.py",
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 10
  }
}
```

---

## 🚀 部署到 Railway

### 1. 创建 Railway 项目

```bash
# 安装 Railway CLI
npm install -g @railway/cli

# 登录
railway login

# 初始化项目
railway init

# 关联到项目
railway link
```

### 2. 设置环境变量

在 Railway Dashboard 设置所有环境变量（见上面"环境变量"章节）

### 3. 部署

```bash
# 推送代码
git add .
git commit -m "Initial Railway service"
railway up

# 或者通过 GitHub 自动部署
railway github add
```

### 4. 查看日志

```bash
railway logs
```

---

## ✅ 验证清单

- [ ] Telethon 客户端成功连接
- [ ] 能正常查询数据库中的 `processing` 视频
- [ ] 能成功下载大文件（测试 25 MB 视频）
- [ ] 能成功上传到 R2
- [ ] 能正确更新数据库状态为 `ready`
- [ ] R2 URL 可以在 miniApp 中正常播放
- [ ] 处理失败时能正确标记为 `failed`
- [ ] 日志输出清晰，方便调试

---

## 🔍 常见问题

### Q1: 如何获取 Telegram API ID 和 Hash？
访问 https://my.telegram.org/apps，创建应用获取。

### Q2: Telethon 如何通过 file_id 下载？
需要在 Bot 插入数据库时，额外存储 `message_id` 和 `chat_id`，Railway 通过这两个字段获取消息。

### Q3: R2 如何配置公开访问？
在 Cloudflare Dashboard → R2 → 设置自定义域名，绑定到您的域名（如 `cdn.example.com`）。

### Q4: Railway 费用？
Railway 提供 $5/月免费额度，处理视频服务通常在免费范围内。

---

## 📚 参考资料

- Telethon 文档: https://docs.telethon.dev/
- Cloudflare R2 文档: https://developers.cloudflare.com/r2/
- Railway 文档: https://docs.railway.app/
- Supabase Python SDK: https://supabase.com/docs/reference/python/

---

## 🎯 后续优化

1. **通知功能**：处理完成后通过 Telegram Bot 通知用户
2. **重试机制**：失败后自动重试，避免手动干预
3. **进度显示**：实时显示下载/上传进度
4. **批量处理**：优化并发处理，提高吞吐量
5. **监控告警**：集成 Sentry 或其他监控工具

---

**创建时间**: 2025-02-04  
**最后更新**: 2025-02-04  
**状态**: 待实现 ⏳

