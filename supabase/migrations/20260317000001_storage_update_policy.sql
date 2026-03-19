-- Allow users to update (overwrite) their own attachments in storage.
-- Required for upsert: true on re-uploads of files with the same name.

create policy "Users can update own attachments"
  on storage.objects for update
  using (
    bucket_id = 'attachments'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
