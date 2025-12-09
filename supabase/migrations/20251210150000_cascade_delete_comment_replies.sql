-- 🎯 修改 video_comments 表的 reply_to 外键约束
-- 将删除评论时的行为从 SET NULL 改为 CASCADE（级联删除子评论）

-- 1. 先删除旧的外键约束
ALTER TABLE public.video_comments 
DROP CONSTRAINT IF EXISTS video_comments_reply_to_fkey;

-- 2. 重新添加外键约束，设置 ON DELETE CASCADE
ALTER TABLE public.video_comments 
ADD CONSTRAINT video_comments_reply_to_fkey 
FOREIGN KEY (reply_to) 
REFERENCES public.video_comments(id) 
ON DELETE CASCADE;

-- 说明：
-- 删除一条评论时，会自动级联删除：
-- 1. 该评论的所有点赞（comment_likes，已有 CASCADE）
-- 2. 该评论的所有子评论（reply_to 指向该评论的记录）
-- 3. 子评论的点赞也会被删除（因为子评论被删除触发 comment_likes 的 CASCADE）

