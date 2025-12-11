-- 成人内容流：按时间倒序，排除已观看的视频
create or replace function public.get_adult_feed(
  p_user_id uuid,
  p_page_no integer,
  p_page_size integer
)
returns setof public.videos
language sql
as $$
  with watched as (
    select video_id
    from public.watch_history
    where user_id = p_user_id
  )
  select *
  from public.videos v
  where v.status = 'published'
    and v.is_adult = true
    and v.id not in (select video_id from watched)
  order by v.created_at desc
  offset p_page_no * p_page_size
  limit p_page_size;
$$;


