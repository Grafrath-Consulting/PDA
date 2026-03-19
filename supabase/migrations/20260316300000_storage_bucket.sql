-- Create storage bucket for journal block attachments
-- 20MB file size limit enforced at the bucket level

insert into storage.buckets (id, name, public, file_size_limit)
values ('attachments', 'attachments', false, 20971520)  -- 20MB = 20 * 1024 * 1024
on conflict (id) do nothing;

-- Storage policies: users can manage their own files (path prefix = user_id/)

create policy "Users can upload own attachments"
  on storage.objects for insert
  with check (
    bucket_id = 'attachments'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Users can view own attachments"
  on storage.objects for select
  using (
    bucket_id = 'attachments'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Users can delete own attachments"
  on storage.objects for delete
  using (
    bucket_id = 'attachments'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
