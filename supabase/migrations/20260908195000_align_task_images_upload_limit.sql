-- The task-images bucket is shared by task and room-check uploads. The API
-- accepts task videos up to the Free-plan ceiling, so the bucket must not reject valid
-- files at its previous 2 MB legacy limit. Manager Room Check videos remain
-- separately limited and compressed in the browser.
update storage.buckets
set file_size_limit = 52428800
where id = 'task-images';
