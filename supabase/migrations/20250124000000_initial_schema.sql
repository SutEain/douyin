-- =====================================================
-- Douyin Database Schema - Initial Migration
-- =====================================================

-- Enable necessary extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm"; -- For full-text search

-- =====================================================
-- 1. PROFILES TABLE (User Extended Info)
-- =====================================================
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  
  -- Basic Info
  username VARCHAR(50) UNIQUE,
  nickname VARCHAR(100),
  bio TEXT,
  avatar_url TEXT,
  cover_url TEXT,
  
  -- Telegram Integration
  tg_user_id BIGINT UNIQUE,
  tg_username VARCHAR(100),
  
  -- Auth & Language
  auth_provider VARCHAR(20) DEFAULT 'email', -- 'email' | 'tg'
  lang VARCHAR(10) DEFAULT 'zh-CN',
  email_verified BOOLEAN DEFAULT FALSE,
  
  -- Statistics (denormalized for performance)
  follower_count INTEGER DEFAULT 0,
  following_count INTEGER DEFAULT 0,
  total_likes INTEGER DEFAULT 0,
  video_count INTEGER DEFAULT 0,
  
  -- Metadata
  last_active_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

-- =====================================================
-- 2. VIDEOS TABLE
-- =====================================================
CREATE TABLE IF NOT EXISTS public.videos (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  author_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  
  -- Content
  title VARCHAR(200) NOT NULL,
  description TEXT,
  title_i18n JSONB, -- {"zh-CN": "标题", "en-US": "Title"}
  description_i18n JSONB,
  
  -- Media URLs
  play_url TEXT NOT NULL,
  cover_url TEXT NOT NULL,
  
  -- Video Properties
  duration INTEGER, -- seconds
  width INTEGER,
  height INTEGER,
  file_size BIGINT,
  
  -- Engagement Metrics (denormalized)
  view_count INTEGER DEFAULT 0,
  like_count INTEGER DEFAULT 0,
  comment_count INTEGER DEFAULT 0,
  share_count INTEGER DEFAULT 0,
  collect_count INTEGER DEFAULT 0,
  
  -- Status & Flags
  is_private BOOLEAN DEFAULT FALSE,
  review_status VARCHAR(20) DEFAULT 'pending', -- pending | auto_approved | manual_review | approved | rejected | appealing
  transcode_status VARCHAR(20) DEFAULT 'pending', -- pending | processing | completed | failed
  
  -- Tags & Categories
  tags TEXT[], -- Array of tags
  category VARCHAR(50),
  
  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  
  -- Constraints
  CONSTRAINT valid_review_status CHECK (review_status IN ('pending', 'auto_approved', 'manual_review', 'approved', 'rejected', 'appealing')),
  CONSTRAINT valid_transcode_status CHECK (transcode_status IN ('pending', 'processing', 'completed', 'failed'))
);

-- =====================================================
-- 3. VIDEO LIKES TABLE
-- =====================================================
CREATE TABLE IF NOT EXISTS public.video_likes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  video_id UUID NOT NULL REFERENCES public.videos(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Unique constraint to prevent duplicate likes
  UNIQUE(user_id, video_id)
);

-- =====================================================
-- 4. VIDEO COMMENTS TABLE
-- =====================================================
CREATE TABLE IF NOT EXISTS public.video_comments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  video_id UUID NOT NULL REFERENCES public.videos(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  
  -- Content
  content TEXT NOT NULL,
  reply_to UUID REFERENCES public.video_comments(id) ON DELETE SET NULL,
  
  -- Metrics
  like_count INTEGER DEFAULT 0,
  
  -- Status
  review_status VARCHAR(20) DEFAULT 'pending',
  
  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  
  CONSTRAINT valid_comment_review_status CHECK (review_status IN ('pending', 'approved', 'rejected'))
);

-- =====================================================
-- 5. VIDEO COLLECTIONS TABLE (Favorites)
-- =====================================================
CREATE TABLE IF NOT EXISTS public.video_collections (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  video_id UUID NOT NULL REFERENCES public.videos(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(user_id, video_id)
);

-- =====================================================
-- 6. FOLLOWS TABLE
-- =====================================================
CREATE TABLE IF NOT EXISTS public.follows (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  follower_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  followee_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Prevent self-follow and duplicate follows
  UNIQUE(follower_id, followee_id),
  CONSTRAINT no_self_follow CHECK (follower_id != followee_id)
);

-- =====================================================
-- 7. WATCH HISTORY TABLE
-- =====================================================
CREATE TABLE IF NOT EXISTS public.watch_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  video_id UUID NOT NULL REFERENCES public.videos(id) ON DELETE CASCADE,
  
  -- Playback info
  progress INTEGER DEFAULT 0, -- seconds watched
  completed BOOLEAN DEFAULT FALSE,
  
  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Update on duplicate
  UNIQUE(user_id, video_id)
);

-- =====================================================
-- 8. NOTIFICATIONS TABLE
-- =====================================================
CREATE TABLE IF NOT EXISTS public.notifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  
  -- Notification details
  type VARCHAR(50) NOT NULL, -- 'like' | 'comment' | 'follow' | 'system'
  title VARCHAR(200),
  content TEXT,
  payload JSONB, -- Flexible data storage
  
  -- Link
  link_url TEXT,
  
  -- Status
  read_at TIMESTAMPTZ,
  
  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- 9. REVIEW TASKS TABLE
-- =====================================================
CREATE TABLE IF NOT EXISTS public.review_tasks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  
  -- Target
  target_type VARCHAR(20) NOT NULL, -- 'video' | 'comment' | 'profile'
  target_id UUID NOT NULL,
  
  -- Review info
  status VARCHAR(20) DEFAULT 'pending', -- pending | approved | rejected
  reason TEXT,
  reviewer_id UUID REFERENCES public.profiles(id),
  
  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  CONSTRAINT valid_target_type CHECK (target_type IN ('video', 'comment', 'profile')),
  CONSTRAINT valid_review_task_status CHECK (status IN ('pending', 'approved', 'rejected'))
);

-- =====================================================
-- INDEXES
-- =====================================================

-- Profiles indexes
CREATE INDEX idx_profiles_username ON public.profiles(username) WHERE deleted_at IS NULL;
CREATE INDEX idx_profiles_tg_user_id ON public.profiles(tg_user_id) WHERE tg_user_id IS NOT NULL;
CREATE INDEX idx_profiles_created_at ON public.profiles(created_at DESC);

-- Videos indexes
CREATE INDEX idx_videos_author_id ON public.videos(author_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_videos_review_status ON public.videos(review_status, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_videos_hot ON public.videos(review_status, like_count DESC, view_count DESC, created_at DESC) WHERE deleted_at IS NULL AND review_status = 'approved';
CREATE INDEX idx_videos_created_brin ON public.videos USING BRIN(created_at); -- Time-series optimization
CREATE INDEX idx_videos_tags ON public.videos USING GIN(tags); -- Array search
CREATE INDEX idx_videos_title_search ON public.videos USING GIN(to_tsvector('simple', title)); -- Full-text search

-- Video likes indexes
CREATE INDEX idx_video_likes_user_id ON public.video_likes(user_id, created_at DESC);
CREATE INDEX idx_video_likes_video_id ON public.video_likes(video_id, created_at DESC);

-- Video comments indexes
CREATE INDEX idx_video_comments_video_id ON public.video_comments(video_id, created_at DESC) WHERE review_status = 'approved' AND deleted_at IS NULL;
CREATE INDEX idx_video_comments_user_id ON public.video_comments(user_id, created_at DESC);

-- Video collections indexes
CREATE INDEX idx_video_collections_user_id ON public.video_collections(user_id, created_at DESC);
CREATE INDEX idx_video_collections_video_id ON public.video_collections(video_id);

-- Follows indexes
CREATE INDEX idx_follows_follower_id ON public.follows(follower_id, created_at DESC);
CREATE INDEX idx_follows_followee_id ON public.follows(followee_id, created_at DESC);
CREATE INDEX idx_follows_composite ON public.follows(follower_id, followee_id);

-- Watch history indexes
CREATE INDEX idx_watch_history_user_id ON public.watch_history(user_id, updated_at DESC);
CREATE INDEX idx_watch_history_video_id ON public.watch_history(video_id);

-- Notifications indexes
CREATE INDEX idx_notifications_user_id ON public.notifications(user_id, created_at DESC);
CREATE INDEX idx_notifications_unread ON public.notifications(user_id, created_at DESC) WHERE read_at IS NULL;

-- Review tasks indexes
CREATE INDEX idx_review_tasks_status ON public.review_tasks(status, created_at DESC);
CREATE INDEX idx_review_tasks_target ON public.review_tasks(target_type, target_id);

-- =====================================================
-- TRIGGERS & FUNCTIONS
-- =====================================================

-- Function: Update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply to tables
CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_videos_updated_at BEFORE UPDATE ON public.videos
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_comments_updated_at BEFORE UPDATE ON public.video_comments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_watch_history_updated_at BEFORE UPDATE ON public.watch_history
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_review_tasks_updated_at BEFORE UPDATE ON public.review_tasks
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Function: Auto-create profile on user signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, username, email_verified)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'username', 'user_' || substr(NEW.id::text, 1, 8)),
    NEW.email_confirmed_at IS NOT NULL
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Function: Update video like count
CREATE OR REPLACE FUNCTION update_video_like_count()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.videos SET like_count = like_count + 1 WHERE id = NEW.video_id;
    UPDATE public.profiles SET total_likes = total_likes + 1 
    WHERE id = (SELECT author_id FROM public.videos WHERE id = NEW.video_id);
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.videos SET like_count = GREATEST(like_count - 1, 0) WHERE id = OLD.video_id;
    UPDATE public.profiles SET total_likes = GREATEST(total_likes - 1, 0)
    WHERE id = (SELECT author_id FROM public.videos WHERE id = OLD.video_id);
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER video_like_count_trigger
  AFTER INSERT OR DELETE ON public.video_likes
  FOR EACH ROW EXECUTE FUNCTION update_video_like_count();

-- Function: Update video comment count
CREATE OR REPLACE FUNCTION update_video_comment_count()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.videos SET comment_count = comment_count + 1 WHERE id = NEW.video_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.videos SET comment_count = GREATEST(comment_count - 1, 0) WHERE id = OLD.video_id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER video_comment_count_trigger
  AFTER INSERT OR DELETE ON public.video_comments
  FOR EACH ROW EXECUTE FUNCTION update_video_comment_count();

-- Function: Update video collect count
CREATE OR REPLACE FUNCTION update_video_collect_count()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.videos SET collect_count = collect_count + 1 WHERE id = NEW.video_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.videos SET collect_count = GREATEST(collect_count - 1, 0) WHERE id = OLD.video_id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER video_collect_count_trigger
  AFTER INSERT OR DELETE ON public.video_collections
  FOR EACH ROW EXECUTE FUNCTION update_video_collect_count();

-- Function: Update follower/following counts
CREATE OR REPLACE FUNCTION update_follow_counts()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.profiles SET following_count = following_count + 1 WHERE id = NEW.follower_id;
    UPDATE public.profiles SET follower_count = follower_count + 1 WHERE id = NEW.followee_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.profiles SET following_count = GREATEST(following_count - 1, 0) WHERE id = OLD.follower_id;
    UPDATE public.profiles SET follower_count = GREATEST(follower_count - 1, 0) WHERE id = OLD.followee_id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER follow_counts_trigger
  AFTER INSERT OR DELETE ON public.follows
  FOR EACH ROW EXECUTE FUNCTION update_follow_counts();

-- Function: Update profile video count
CREATE OR REPLACE FUNCTION update_profile_video_count()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.deleted_at IS NULL THEN
    UPDATE public.profiles SET video_count = video_count + 1 WHERE id = NEW.author_id;
  ELSIF TG_OP = 'UPDATE' AND OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
    UPDATE public.profiles SET video_count = GREATEST(video_count - 1, 0) WHERE id = NEW.author_id;
  ELSIF TG_OP = 'DELETE' AND OLD.deleted_at IS NULL THEN
    UPDATE public.profiles SET video_count = GREATEST(video_count - 1, 0) WHERE id = OLD.author_id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER profile_video_count_trigger
  AFTER INSERT OR UPDATE OR DELETE ON public.videos
  FOR EACH ROW EXECUTE FUNCTION update_profile_video_count();

-- =====================================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- =====================================================

-- Enable RLS on all tables
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.videos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.video_likes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.video_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.video_collections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.follows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.watch_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.review_tasks ENABLE ROW LEVEL SECURITY;

-- Profiles policies
CREATE POLICY "Public profiles are viewable by everyone"
  ON public.profiles FOR SELECT
  USING (deleted_at IS NULL);

CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = id);

-- Videos policies
CREATE POLICY "Approved public videos are viewable by everyone"
  ON public.videos FOR SELECT
  USING (
    deleted_at IS NULL AND
    (
      (review_status = 'approved' AND is_private = FALSE) OR
      (author_id = auth.uid())
    )
  );

CREATE POLICY "Users can insert own videos"
  ON public.videos FOR INSERT
  WITH CHECK (auth.uid() = author_id);

CREATE POLICY "Users can update own videos"
  ON public.videos FOR UPDATE
  USING (auth.uid() = author_id);

CREATE POLICY "Users can delete own videos"
  ON public.videos FOR DELETE
  USING (auth.uid() = author_id);

-- Video likes policies
CREATE POLICY "Video likes are viewable by everyone"
  ON public.video_likes FOR SELECT
  USING (true);

CREATE POLICY "Users can insert own likes"
  ON public.video_likes FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own likes"
  ON public.video_likes FOR DELETE
  USING (auth.uid() = user_id);

-- Video comments policies
CREATE POLICY "Approved comments are viewable by everyone"
  ON public.video_comments FOR SELECT
  USING (deleted_at IS NULL AND (review_status = 'approved' OR user_id = auth.uid()));

CREATE POLICY "Users can insert own comments"
  ON public.video_comments FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own comments"
  ON public.video_comments FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own comments"
  ON public.video_comments FOR DELETE
  USING (auth.uid() = user_id);

-- Video collections policies
CREATE POLICY "Users can view own collections"
  ON public.video_collections FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own collections"
  ON public.video_collections FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own collections"
  ON public.video_collections FOR DELETE
  USING (auth.uid() = user_id);

-- Follows policies
CREATE POLICY "Follows are viewable by everyone"
  ON public.follows FOR SELECT
  USING (true);

CREATE POLICY "Users can insert own follows"
  ON public.follows FOR INSERT
  WITH CHECK (auth.uid() = follower_id);

CREATE POLICY "Users can delete own follows"
  ON public.follows FOR DELETE
  USING (auth.uid() = follower_id);

-- Watch history policies
CREATE POLICY "Users can view own watch history"
  ON public.watch_history FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own watch history"
  ON public.watch_history FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own watch history"
  ON public.watch_history FOR UPDATE
  USING (auth.uid() = user_id);

-- Notifications policies
CREATE POLICY "Users can view own notifications"
  ON public.notifications FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can update own notifications"
  ON public.notifications FOR UPDATE
  USING (auth.uid() = user_id);

-- Review tasks policies (admin only - will be refined later)
CREATE POLICY "Review tasks viewable by admins"
  ON public.review_tasks FOR SELECT
  USING (true); -- TODO: Add admin role check

-- =====================================================
-- COMMENTS
-- =====================================================

COMMENT ON TABLE public.profiles IS 'Extended user profile information';
COMMENT ON TABLE public.videos IS 'Video content and metadata';
COMMENT ON TABLE public.video_likes IS 'User likes on videos';
COMMENT ON TABLE public.video_comments IS 'Comments on videos';
COMMENT ON TABLE public.video_collections IS 'User favorite/collected videos';
COMMENT ON TABLE public.follows IS 'User follow relationships';
COMMENT ON TABLE public.watch_history IS 'Video watch history and progress';
COMMENT ON TABLE public.notifications IS 'User notifications';
COMMENT ON TABLE public.review_tasks IS 'Content moderation tasks';
