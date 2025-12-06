SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "public";


ALTER SCHEMA "public" OWNER TO "pg_database_owner";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  INSERT INTO public.profiles (id, username, email_verified)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'username', 'user_' || substr(NEW.id::text, 1, 8)),
    NEW.email_confirmed_at IS NOT NULL
  );
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."handle_new_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_follow_counts"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
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
$$;


ALTER FUNCTION "public"."update_follow_counts"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_profile_video_count"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
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
$$;


ALTER FUNCTION "public"."update_profile_video_count"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_updated_at_column"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_updated_at_column"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_user_bot_states_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_user_bot_states_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_video_collect_count"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.videos SET collect_count = collect_count + 1 WHERE id = NEW.video_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.videos SET collect_count = GREATEST(collect_count - 1, 0) WHERE id = OLD.video_id;
  END IF;
  RETURN NULL;
END;
$$;


ALTER FUNCTION "public"."update_video_collect_count"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_video_comment_count"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.videos SET comment_count = comment_count + 1 WHERE id = NEW.video_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.videos SET comment_count = GREATEST(comment_count - 1, 0) WHERE id = OLD.video_id;
  END IF;
  RETURN NULL;
END;
$$;


ALTER FUNCTION "public"."update_video_comment_count"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_video_like_count"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
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
$$;


ALTER FUNCTION "public"."update_video_like_count"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."follows" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "follower_id" "uuid" NOT NULL,
    "followee_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "no_self_follow" CHECK (("follower_id" <> "followee_id"))
);


ALTER TABLE "public"."follows" OWNER TO "postgres";


COMMENT ON TABLE "public"."follows" IS 'User follow relationships';



CREATE TABLE IF NOT EXISTS "public"."notifications" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "type" character varying(50) NOT NULL,
    "title" character varying(200),
    "content" "text",
    "payload" "jsonb",
    "link_url" "text",
    "read_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."notifications" OWNER TO "postgres";


COMMENT ON TABLE "public"."notifications" IS 'User notifications';



CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" NOT NULL,
    "username" character varying(50),
    "nickname" character varying(100),
    "bio" "text",
    "avatar_url" "text",
    "cover_url" "text",
    "tg_user_id" bigint,
    "tg_username" character varying(100),
    "auth_provider" character varying(20) DEFAULT 'email'::character varying,
    "lang" character varying(10) DEFAULT 'zh-CN'::character varying,
    "email_verified" boolean DEFAULT false,
    "follower_count" integer DEFAULT 0,
    "following_count" integer DEFAULT 0,
    "total_likes" integer DEFAULT 0,
    "video_count" integer DEFAULT 0,
    "last_active_at" timestamp with time zone DEFAULT "now"(),
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "deleted_at" timestamp with time zone,
    "gender" smallint DEFAULT 0,
    "birthday" "date",
    "country" "text",
    "province" "text",
    "city" "text"
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";


COMMENT ON TABLE "public"."profiles" IS 'Extended user profile information';



COMMENT ON COLUMN "public"."profiles"."gender" IS '0=unknown,1=male,2=female';



COMMENT ON COLUMN "public"."profiles"."birthday" IS 'YYYY-MM-DD';



COMMENT ON COLUMN "public"."profiles"."country" IS 'User selected country';



COMMENT ON COLUMN "public"."profiles"."province" IS 'Reserved for future regional data';



COMMENT ON COLUMN "public"."profiles"."city" IS 'Reserved for future city data';



CREATE TABLE IF NOT EXISTS "public"."review_tasks" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "target_type" character varying(20) NOT NULL,
    "target_id" "uuid" NOT NULL,
    "status" character varying(20) DEFAULT 'pending'::character varying,
    "reason" "text",
    "reviewer_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "valid_review_task_status" CHECK ((("status")::"text" = ANY ((ARRAY['pending'::character varying, 'approved'::character varying, 'rejected'::character varying])::"text"[]))),
    CONSTRAINT "valid_target_type" CHECK ((("target_type")::"text" = ANY ((ARRAY['video'::character varying, 'comment'::character varying, 'profile'::character varying])::"text"[])))
);


ALTER TABLE "public"."review_tasks" OWNER TO "postgres";


COMMENT ON TABLE "public"."review_tasks" IS 'Content moderation tasks';



CREATE TABLE IF NOT EXISTS "public"."user_bot_states" (
    "user_id" bigint NOT NULL,
    "state" character varying(50) DEFAULT 'idle'::character varying,
    "draft_video_id" "uuid",
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "current_message_id" bigint
);


ALTER TABLE "public"."user_bot_states" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."video_collections" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "video_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."video_collections" OWNER TO "postgres";


COMMENT ON TABLE "public"."video_collections" IS 'User favorite/collected videos';



CREATE TABLE IF NOT EXISTS "public"."video_comments" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "video_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "content" "text" NOT NULL,
    "reply_to" "uuid",
    "like_count" integer DEFAULT 0,
    "review_status" character varying(20) DEFAULT 'pending'::character varying,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "deleted_at" timestamp with time zone,
    CONSTRAINT "valid_comment_review_status" CHECK ((("review_status")::"text" = ANY ((ARRAY['pending'::character varying, 'approved'::character varying, 'rejected'::character varying])::"text"[])))
);


ALTER TABLE "public"."video_comments" OWNER TO "postgres";


COMMENT ON TABLE "public"."video_comments" IS 'Comments on videos';



CREATE TABLE IF NOT EXISTS "public"."video_likes" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "video_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."video_likes" OWNER TO "postgres";


COMMENT ON TABLE "public"."video_likes" IS 'User likes on videos';



CREATE TABLE IF NOT EXISTS "public"."videos" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "author_id" "uuid",
    "title" character varying(200) NOT NULL,
    "description" "text",
    "title_i18n" "jsonb",
    "description_i18n" "jsonb",
    "play_url" "text" NOT NULL,
    "cover_url" "text" NOT NULL,
    "duration" integer,
    "width" integer,
    "height" integer,
    "file_size" bigint,
    "view_count" integer DEFAULT 0,
    "like_count" integer DEFAULT 0,
    "comment_count" integer DEFAULT 0,
    "share_count" integer DEFAULT 0,
    "collect_count" integer DEFAULT 0,
    "is_private" boolean DEFAULT false,
    "review_status" character varying(20) DEFAULT 'pending'::character varying,
    "transcode_status" character varying(20) DEFAULT 'pending'::character varying,
    "tags" "text"[],
    "category" character varying(50),
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "deleted_at" timestamp with time zone,
    "location_country" character varying(100),
    "location_country_code" character varying(2),
    "status" character varying(20) DEFAULT 'draft'::character varying,
    "published_at" timestamp with time zone,
    "tg_file_id" "text",
    "tg_unique_id" "text",
    "tg_thumbnail_file_id" "text",
    "storage_type" character varying(20) DEFAULT 'oss'::character varying,
    "transfer_attempts" integer DEFAULT 0,
    "transfer_error" "text",
    "tg_user_id" bigint,
    "location_city" character varying(100),
    "is_top" boolean DEFAULT false,
    CONSTRAINT "chk_description_length" CHECK (("char_length"("description") <= 500)),
    CONSTRAINT "chk_status" CHECK ((("status")::"text" = ANY ((ARRAY['draft'::character varying, 'published'::character varying])::"text"[]))),
    CONSTRAINT "chk_tags_count" CHECK ((("array_length"("tags", 1) IS NULL) OR (("array_length"("tags", 1) >= 1) AND ("array_length"("tags", 1) <= 5)))),
    CONSTRAINT "valid_review_status" CHECK ((("review_status")::"text" = ANY ((ARRAY['pending'::character varying, 'auto_approved'::character varying, 'manual_review'::character varying, 'approved'::character varying, 'rejected'::character varying, 'appealing'::character varying])::"text"[]))),
    CONSTRAINT "valid_transcode_status" CHECK ((("transcode_status")::"text" = ANY ((ARRAY['pending'::character varying, 'processing'::character varying, 'completed'::character varying, 'failed'::character varying])::"text"[])))
);


ALTER TABLE "public"."videos" OWNER TO "postgres";


COMMENT ON TABLE "public"."videos" IS 'Video content and metadata';



COMMENT ON COLUMN "public"."videos"."description" IS '视频描述（最多200字）';



COMMENT ON COLUMN "public"."videos"."is_private" IS '隐私设置：true=私密，false=公开';



COMMENT ON COLUMN "public"."videos"."tags" IS '标签数组（3-5个）';



COMMENT ON COLUMN "public"."videos"."location_country" IS '国家名称（如：中国）';



COMMENT ON COLUMN "public"."videos"."location_country_code" IS '国家代码（如：CN）';



COMMENT ON COLUMN "public"."videos"."status" IS '状态：draft=草稿，published=已发布';



COMMENT ON COLUMN "public"."videos"."published_at" IS '发布时间（仅 published 状态有值）';



COMMENT ON COLUMN "public"."videos"."is_top" IS '是否置顶（true=置顶）';



CREATE TABLE IF NOT EXISTS "public"."watch_history" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "video_id" "uuid" NOT NULL,
    "progress" integer DEFAULT 0,
    "completed" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."watch_history" OWNER TO "postgres";


COMMENT ON TABLE "public"."watch_history" IS 'Video watch history and progress';



ALTER TABLE ONLY "public"."follows"
    ADD CONSTRAINT "follows_follower_id_followee_id_key" UNIQUE ("follower_id", "followee_id");



ALTER TABLE ONLY "public"."follows"
    ADD CONSTRAINT "follows_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_tg_user_id_key" UNIQUE ("tg_user_id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_username_key" UNIQUE ("username");



ALTER TABLE ONLY "public"."review_tasks"
    ADD CONSTRAINT "review_tasks_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_bot_states"
    ADD CONSTRAINT "user_bot_states_pkey" PRIMARY KEY ("user_id");



ALTER TABLE ONLY "public"."video_collections"
    ADD CONSTRAINT "video_collections_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."video_collections"
    ADD CONSTRAINT "video_collections_user_id_video_id_key" UNIQUE ("user_id", "video_id");



ALTER TABLE ONLY "public"."video_comments"
    ADD CONSTRAINT "video_comments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."video_likes"
    ADD CONSTRAINT "video_likes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."video_likes"
    ADD CONSTRAINT "video_likes_user_id_video_id_key" UNIQUE ("user_id", "video_id");



ALTER TABLE ONLY "public"."videos"
    ADD CONSTRAINT "videos_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."watch_history"
    ADD CONSTRAINT "watch_history_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."watch_history"
    ADD CONSTRAINT "watch_history_user_id_video_id_key" UNIQUE ("user_id", "video_id");



CREATE INDEX "idx_follows_composite" ON "public"."follows" USING "btree" ("follower_id", "followee_id");



CREATE INDEX "idx_follows_followee_id" ON "public"."follows" USING "btree" ("followee_id", "created_at" DESC);



CREATE INDEX "idx_follows_follower_id" ON "public"."follows" USING "btree" ("follower_id", "created_at" DESC);



CREATE INDEX "idx_notifications_unread" ON "public"."notifications" USING "btree" ("user_id", "created_at" DESC) WHERE ("read_at" IS NULL);



CREATE INDEX "idx_notifications_user_id" ON "public"."notifications" USING "btree" ("user_id", "created_at" DESC);



CREATE INDEX "idx_profiles_created_at" ON "public"."profiles" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_profiles_tg_user_id" ON "public"."profiles" USING "btree" ("tg_user_id") WHERE ("tg_user_id" IS NOT NULL);



CREATE INDEX "idx_profiles_username" ON "public"."profiles" USING "btree" ("username") WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_review_tasks_status" ON "public"."review_tasks" USING "btree" ("status", "created_at" DESC);



CREATE INDEX "idx_review_tasks_target" ON "public"."review_tasks" USING "btree" ("target_type", "target_id");



CREATE INDEX "idx_video_collections_user_id" ON "public"."video_collections" USING "btree" ("user_id", "created_at" DESC);



CREATE INDEX "idx_video_collections_video_id" ON "public"."video_collections" USING "btree" ("video_id");



CREATE INDEX "idx_video_comments_user_id" ON "public"."video_comments" USING "btree" ("user_id", "created_at" DESC);



CREATE INDEX "idx_video_comments_video_id" ON "public"."video_comments" USING "btree" ("video_id", "created_at" DESC) WHERE ((("review_status")::"text" = 'approved'::"text") AND ("deleted_at" IS NULL));



CREATE INDEX "idx_video_likes_user_id" ON "public"."video_likes" USING "btree" ("user_id", "created_at" DESC);



CREATE INDEX "idx_video_likes_video_id" ON "public"."video_likes" USING "btree" ("video_id", "created_at" DESC);



CREATE INDEX "idx_videos_author_id" ON "public"."videos" USING "btree" ("author_id", "created_at" DESC) WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_videos_city" ON "public"."videos" USING "btree" ("location_city");



CREATE INDEX "idx_videos_country" ON "public"."videos" USING "btree" ("location_country_code");



CREATE INDEX "idx_videos_created_brin" ON "public"."videos" USING "brin" ("created_at");



CREATE INDEX "idx_videos_hot" ON "public"."videos" USING "btree" ("review_status", "like_count" DESC, "view_count" DESC, "created_at" DESC) WHERE (("deleted_at" IS NULL) AND (("review_status")::"text" = 'approved'::"text"));



CREATE INDEX "idx_videos_published_at" ON "public"."videos" USING "btree" ("published_at") WHERE (("status")::"text" = 'published'::"text");



CREATE INDEX "idx_videos_review_status" ON "public"."videos" USING "btree" ("review_status", "created_at" DESC) WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_videos_status" ON "public"."videos" USING "btree" ("status");



CREATE INDEX "idx_videos_tags" ON "public"."videos" USING "gin" ("tags");



CREATE INDEX "idx_videos_tg_file_id" ON "public"."videos" USING "btree" ("tg_file_id");



CREATE INDEX "idx_videos_tg_user_id" ON "public"."videos" USING "btree" ("tg_user_id");



CREATE INDEX "idx_videos_tg_user_id_is_top" ON "public"."videos" USING "btree" ("tg_user_id", "is_top");



CREATE INDEX "idx_videos_title_search" ON "public"."videos" USING "gin" ("to_tsvector"('"simple"'::"regconfig", ("title")::"text"));



CREATE INDEX "idx_watch_history_user_id" ON "public"."watch_history" USING "btree" ("user_id", "updated_at" DESC);



CREATE INDEX "idx_watch_history_video_id" ON "public"."watch_history" USING "btree" ("video_id");



CREATE OR REPLACE TRIGGER "follow_counts_trigger" AFTER INSERT OR DELETE ON "public"."follows" FOR EACH ROW EXECUTE FUNCTION "public"."update_follow_counts"();



CREATE OR REPLACE TRIGGER "profile_video_count_trigger" AFTER INSERT OR DELETE OR UPDATE ON "public"."videos" FOR EACH ROW EXECUTE FUNCTION "public"."update_profile_video_count"();



CREATE OR REPLACE TRIGGER "trigger_user_bot_states_updated_at" BEFORE UPDATE ON "public"."user_bot_states" FOR EACH ROW EXECUTE FUNCTION "public"."update_user_bot_states_updated_at"();



CREATE OR REPLACE TRIGGER "update_comments_updated_at" BEFORE UPDATE ON "public"."video_comments" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_profiles_updated_at" BEFORE UPDATE ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_review_tasks_updated_at" BEFORE UPDATE ON "public"."review_tasks" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_videos_updated_at" BEFORE UPDATE ON "public"."videos" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_watch_history_updated_at" BEFORE UPDATE ON "public"."watch_history" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "video_collect_count_trigger" AFTER INSERT OR DELETE ON "public"."video_collections" FOR EACH ROW EXECUTE FUNCTION "public"."update_video_collect_count"();



CREATE OR REPLACE TRIGGER "video_comment_count_trigger" AFTER INSERT OR DELETE ON "public"."video_comments" FOR EACH ROW EXECUTE FUNCTION "public"."update_video_comment_count"();



CREATE OR REPLACE TRIGGER "video_like_count_trigger" AFTER INSERT OR DELETE ON "public"."video_likes" FOR EACH ROW EXECUTE FUNCTION "public"."update_video_like_count"();



ALTER TABLE ONLY "public"."follows"
    ADD CONSTRAINT "follows_followee_id_fkey" FOREIGN KEY ("followee_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."follows"
    ADD CONSTRAINT "follows_follower_id_fkey" FOREIGN KEY ("follower_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."review_tasks"
    ADD CONSTRAINT "review_tasks_reviewer_id_fkey" FOREIGN KEY ("reviewer_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."video_collections"
    ADD CONSTRAINT "video_collections_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."video_collections"
    ADD CONSTRAINT "video_collections_video_id_fkey" FOREIGN KEY ("video_id") REFERENCES "public"."videos"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."video_comments"
    ADD CONSTRAINT "video_comments_reply_to_fkey" FOREIGN KEY ("reply_to") REFERENCES "public"."video_comments"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."video_comments"
    ADD CONSTRAINT "video_comments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."video_comments"
    ADD CONSTRAINT "video_comments_video_id_fkey" FOREIGN KEY ("video_id") REFERENCES "public"."videos"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."video_likes"
    ADD CONSTRAINT "video_likes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."video_likes"
    ADD CONSTRAINT "video_likes_video_id_fkey" FOREIGN KEY ("video_id") REFERENCES "public"."videos"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."videos"
    ADD CONSTRAINT "videos_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."watch_history"
    ADD CONSTRAINT "watch_history_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."watch_history"
    ADD CONSTRAINT "watch_history_video_id_fkey" FOREIGN KEY ("video_id") REFERENCES "public"."videos"("id") ON DELETE CASCADE;



CREATE POLICY "Approved comments are viewable by everyone" ON "public"."video_comments" FOR SELECT USING ((("deleted_at" IS NULL) AND ((("review_status")::"text" = 'approved'::"text") OR ("user_id" = "auth"."uid"()))));



CREATE POLICY "Approved public videos are viewable by everyone" ON "public"."videos" FOR SELECT USING ((("deleted_at" IS NULL) AND (((("review_status")::"text" = 'approved'::"text") AND ("is_private" = false)) OR ("author_id" = "auth"."uid"()))));



CREATE POLICY "Follows are viewable by everyone" ON "public"."follows" FOR SELECT USING (true);



CREATE POLICY "Public profiles are viewable by everyone" ON "public"."profiles" FOR SELECT USING (("deleted_at" IS NULL));



CREATE POLICY "Review tasks viewable by admins" ON "public"."review_tasks" FOR SELECT USING (true);



CREATE POLICY "Service role can do anything" ON "public"."user_bot_states" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "Service role can manage all videos" ON "public"."videos" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "Users can delete own collections" ON "public"."video_collections" FOR DELETE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can delete own comments" ON "public"."video_comments" FOR DELETE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can delete own follows" ON "public"."follows" FOR DELETE USING (("auth"."uid"() = "follower_id"));



CREATE POLICY "Users can delete own likes" ON "public"."video_likes" FOR DELETE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can delete own videos" ON "public"."videos" FOR DELETE USING (("auth"."uid"() = "author_id"));



CREATE POLICY "Users can insert own collections" ON "public"."video_collections" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can insert own comments" ON "public"."video_comments" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can insert own follows" ON "public"."follows" FOR INSERT WITH CHECK (("auth"."uid"() = "follower_id"));



CREATE POLICY "Users can insert own likes" ON "public"."video_likes" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can insert own videos" ON "public"."videos" FOR INSERT WITH CHECK (("auth"."uid"() = "author_id"));



CREATE POLICY "Users can insert own watch history" ON "public"."watch_history" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can update own comments" ON "public"."video_comments" FOR UPDATE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can update own notifications" ON "public"."notifications" FOR UPDATE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can update own profile" ON "public"."profiles" FOR UPDATE USING (("auth"."uid"() = "id"));



CREATE POLICY "Users can update own videos" ON "public"."videos" FOR UPDATE USING (("auth"."uid"() = "author_id"));



CREATE POLICY "Users can update own watch history" ON "public"."watch_history" FOR UPDATE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view own collections" ON "public"."video_collections" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view own notifications" ON "public"."notifications" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view own watch history" ON "public"."watch_history" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Video likes are viewable by everyone" ON "public"."video_likes" FOR SELECT USING (true);



ALTER TABLE "public"."follows" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."notifications" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."review_tasks" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_bot_states" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."video_collections" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."video_comments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."video_likes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."videos" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."watch_history" ENABLE ROW LEVEL SECURITY;


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_follow_counts"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_follow_counts"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_follow_counts"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_profile_video_count"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_profile_video_count"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_profile_video_count"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_user_bot_states_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_user_bot_states_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_user_bot_states_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_video_collect_count"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_video_collect_count"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_video_collect_count"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_video_comment_count"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_video_comment_count"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_video_comment_count"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_video_like_count"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_video_like_count"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_video_like_count"() TO "service_role";



GRANT ALL ON TABLE "public"."follows" TO "anon";
GRANT ALL ON TABLE "public"."follows" TO "authenticated";
GRANT ALL ON TABLE "public"."follows" TO "service_role";



GRANT ALL ON TABLE "public"."notifications" TO "anon";
GRANT ALL ON TABLE "public"."notifications" TO "authenticated";
GRANT ALL ON TABLE "public"."notifications" TO "service_role";



GRANT ALL ON TABLE "public"."profiles" TO "anon";
GRANT ALL ON TABLE "public"."profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."profiles" TO "service_role";



GRANT ALL ON TABLE "public"."review_tasks" TO "anon";
GRANT ALL ON TABLE "public"."review_tasks" TO "authenticated";
GRANT ALL ON TABLE "public"."review_tasks" TO "service_role";



GRANT ALL ON TABLE "public"."user_bot_states" TO "anon";
GRANT ALL ON TABLE "public"."user_bot_states" TO "authenticated";
GRANT ALL ON TABLE "public"."user_bot_states" TO "service_role";



GRANT ALL ON TABLE "public"."video_collections" TO "anon";
GRANT ALL ON TABLE "public"."video_collections" TO "authenticated";
GRANT ALL ON TABLE "public"."video_collections" TO "service_role";



GRANT ALL ON TABLE "public"."video_comments" TO "anon";
GRANT ALL ON TABLE "public"."video_comments" TO "authenticated";
GRANT ALL ON TABLE "public"."video_comments" TO "service_role";



GRANT ALL ON TABLE "public"."video_likes" TO "anon";
GRANT ALL ON TABLE "public"."video_likes" TO "authenticated";
GRANT ALL ON TABLE "public"."video_likes" TO "service_role";



GRANT ALL ON TABLE "public"."videos" TO "anon";
GRANT ALL ON TABLE "public"."videos" TO "authenticated";
GRANT ALL ON TABLE "public"."videos" TO "service_role";



GRANT ALL ON TABLE "public"."watch_history" TO "anon";
GRANT ALL ON TABLE "public"."watch_history" TO "authenticated";
GRANT ALL ON TABLE "public"."watch_history" TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";







