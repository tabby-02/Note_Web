create extension if not exists pgcrypto;
create extension if not exists pg_trgm;

create table public.taxonomy_nodes (
  id text primary key,
  parent_id text references public.taxonomy_nodes(id) on delete restrict,
  title text not null,
  slug text not null,
  kind text not null check (kind in ('group', 'note')),
  note_type text check (note_type in ('markdown', 'docx', 'gallery')),
  position integer not null default 0,
  legacy_slugs_json jsonb not null default '[]'::jsonb,
  source_json jsonb not null default '{}'::jsonb,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((kind = 'group' and note_type is null) or (kind = 'note' and note_type is not null))
);

create unique index taxonomy_sibling_slug on public.taxonomy_nodes(coalesce(parent_id, ''), slug);
create index taxonomy_parent_position on public.taxonomy_nodes(parent_id, position, id);

create table public.note_versions (
  id uuid primary key default gen_random_uuid(),
  note_id text not null references public.taxonomy_nodes(id) on delete restrict,
  version integer not null,
  status text not null check (status in ('staging', 'published', 'superseded', 'discarded')),
  manifest_json jsonb not null default '{}'::jsonb,
  base_version_id uuid,
  upload_mode text,
  expected_files_json jsonb not null default '[]'::jsonb,
  markdown_object_key text,
  docx_object_key text,
  created_at timestamptz not null default now(),
  created_by text not null default 'admin',
  unique(note_id, version)
);

create index note_versions_note_status on public.note_versions(note_id, status, version desc);
create unique index note_versions_single_published on public.note_versions(note_id) where status = 'published';

create table public.note_assets (
  id uuid primary key default gen_random_uuid(),
  note_id text not null references public.taxonomy_nodes(id) on delete restrict,
  version_id uuid not null references public.note_versions(id) on delete restrict,
  relative_path text not null,
  object_key text not null,
  role text not null check (role in ('source', 'media', 'attachment', 'gallery-image', 'docx', 'pdf')),
  mime_type text not null,
  size_bytes bigint not null check (size_bytes >= 0),
  sha256 text not null,
  created_at timestamptz not null default now(),
  unique(version_id, relative_path)
);

create index note_assets_version on public.note_assets(version_id, relative_path);
create index note_assets_note_version on public.note_assets(note_id, version_id);
create index note_assets_object_key on public.note_assets(object_key);

create table public.search_passages (
  id bigint generated always as identity primary key,
  note_id text not null references public.taxonomy_nodes(id) on delete cascade,
  version_id uuid not null references public.note_versions(id) on delete cascade,
  scope text not null check (scope in ('topic', 'outline', 'body')),
  anchor text not null default '',
  title text not null,
  content text not null,
  unique(version_id, scope, anchor)
);

create index search_passages_note_version_scope on public.search_passages(note_id, version_id, scope);
create index search_passages_title_trgm on public.search_passages using gin(title gin_trgm_ops);
create index search_passages_content_trgm on public.search_passages using gin(content gin_trgm_ops);

create table public.admin_login_attempts (
  client_key text primary key,
  failures integer not null default 0,
  window_started_at timestamptz not null,
  locked_until timestamptz not null default to_timestamp(0)
);

create table public.content_events (
  id uuid primary key default gen_random_uuid(),
  note_id text,
  event_type text not null,
  version_id uuid,
  detail_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index content_events_note_created on public.content_events(note_id, created_at desc);

alter table public.taxonomy_nodes enable row level security;
alter table public.note_versions enable row level security;
alter table public.note_assets enable row level security;
alter table public.search_passages enable row level security;
alter table public.admin_login_attempts enable row level security;
alter table public.content_events enable row level security;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'note-assets',
  'note-assets',
  false,
  52428800,
  array[
    'image/avif','image/gif','image/jpeg','image/png','image/webp','image/svg+xml','application/octet-stream',
    'application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/msword','application/zip','text/plain','text/markdown','text/csv',
    'application/json','application/xml','application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ]
)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;

create or replace function public.start_note_upload(
  p_note_id text,
  p_expected_version integer,
  p_mode text,
  p_operation_id uuid,
  p_files jsonb default '[]'::jsonb
) returns table(operation_id uuid, version integer, note_type text)
language plpgsql security definer set search_path = public as $$
declare
  n public.taxonomy_nodes%rowtype;
  active public.note_versions%rowtype;
  next_version integer;
  next_manifest jsonb;
begin
  if p_mode not in ('edit','main','main-media','attachments','folder') then raise exception 'invalid upload mode'; end if;
  select * into n from public.taxonomy_nodes where id = p_note_id and kind = 'note' and deleted_at is null for update;
  if not found then raise exception 'note not found'; end if;
  select * into active from public.note_versions where note_id = p_note_id and status = 'published' for update;
  if coalesce(active.version, 0) <> p_expected_version then raise exception 'version conflict'; end if;
  select coalesce(max(v.version),0)+1 into next_version from public.note_versions v where v.note_id=p_note_id;
  next_manifest := coalesce(active.manifest_json, jsonb_build_object(
    'title', n.title,
    'type', n.note_type,
    'mainFile', case n.note_type when 'markdown' then 'note.md' when 'docx' then 'note.docx' else null end
  ));
  insert into public.note_versions (id,note_id,version,status,manifest_json,markdown_object_key,docx_object_key,created_by,base_version_id,upload_mode,expected_files_json)
  values (
    p_operation_id,p_note_id,next_version,'staging',next_manifest,
    case when p_mode <> 'folder' then active.markdown_object_key else null end,
    case when p_mode <> 'folder' then active.docx_object_key else null end,
    'admin',active.id,p_mode,p_files
  );

  if active.id is not null and p_mode <> 'folder' then
    insert into public.note_assets(note_id,version_id,relative_path,object_key,role,mime_type,size_bytes,sha256)
      select note_id,p_operation_id,relative_path,object_key,role,mime_type,size_bytes,sha256
      from public.note_assets where version_id = active.id
      and (p_mode <> 'main-media' or role not in ('media','gallery-image'));
    insert into public.search_passages(note_id,version_id,scope,anchor,title,content)
      select note_id,p_operation_id,scope,anchor,title,content from public.search_passages where version_id=active.id;
  else
    insert into public.search_passages(note_id,version_id,scope,anchor,title,content)
      values (p_note_id,p_operation_id,'topic',p_note_id,n.title,n.title);
  end if;

  return query select p_operation_id,next_version,n.note_type;
end;
$$;

create or replace function public.publish_note_version(p_note_id text, p_operation_id uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare
  n public.taxonomy_nodes%rowtype;
  v public.note_versions%rowtype;
  active_id uuid;
begin
  select * into n from public.taxonomy_nodes where id=p_note_id and kind='note' and deleted_at is null for update;
  if not found then raise exception 'note not found'; end if;
  select * into v from public.note_versions where id=p_operation_id and note_id=p_note_id and status='staging' for update;
  if not found then raise exception 'upload operation expired'; end if;
  select id into active_id from public.note_versions where note_id=p_note_id and status='published';
  if active_id is distinct from v.base_version_id then raise exception 'version conflict'; end if;
  if v.upload_mode <> 'edit' and (jsonb_array_length(v.expected_files_json)=0 or exists (
    select 1 from jsonb_array_elements(v.expected_files_json) f
    where not exists(select 1 from public.note_assets a where a.version_id=v.id and a.relative_path=f->>'path'
      and a.object_key like '%/'||v.id::text||'/%' and a.size_bytes=(f->>'size')::bigint)
  )) then raise exception 'all planned uploads must be completed'; end if;
  if n.note_type='markdown' and v.markdown_object_key is null then raise exception 'note.md is required'; end if;
  if n.note_type='docx' and not exists(select 1 from public.note_assets where version_id=p_operation_id and relative_path='note.docx' and role='docx') then raise exception 'note.docx is required'; end if;
  if n.note_type='gallery' and not exists(select 1 from public.note_assets where version_id=p_operation_id and role='gallery-image') then raise exception 'gallery requires at least one image'; end if;
  update public.note_versions set status='superseded' where note_id=p_note_id and status='published';
  update public.note_versions set status='published' where id=p_operation_id;
  update public.taxonomy_nodes set updated_at=now() where id=p_note_id;
  insert into public.content_events(note_id,event_type,version_id,detail_json) values (p_note_id,'version-published',p_operation_id,jsonb_build_object('version',v.version));
  return v.version;
end;
$$;

create or replace function public.restore_note_version(p_note_id text, p_target_version integer, p_expected_version integer)
returns integer language plpgsql security definer set search_path = public as $$
declare
  active_id uuid;
  target_id uuid;
  target_version integer;
begin
  perform 1 from public.taxonomy_nodes where id=p_note_id and kind='note' and deleted_at is null for update;
  if not found then raise exception 'note not found'; end if;
  select id into active_id from public.note_versions where note_id=p_note_id and status='published' for update;
  if (select version from public.note_versions where id=active_id) is distinct from p_expected_version then raise exception 'version conflict'; end if;
  select id,version into target_id,target_version from public.note_versions
    where note_id=p_note_id and version=p_target_version and status='superseded' for update;
  if target_id is null then raise exception 'version not found'; end if;
  update public.note_versions set status='superseded' where id=active_id;
  update public.note_versions set status='published' where id=target_id;
  insert into public.content_events(note_id,event_type,version_id,detail_json)
    values (p_note_id,'version-restored',target_id,jsonb_build_object('from',active_id,'to',target_version));
  return target_version;
end;
$$;

create or replace function public.search_note_passages(
  p_query text,
  p_scope text,
  p_note_id text,
  p_limit integer,
  p_offset integer
) returns table(note_id text,scope text,anchor text,title text,content text,note_title text,total_count bigint)
language sql stable security definer set search_path = public as $$
  select p.note_id,p.scope,p.anchor,p.title,p.content,n.title,
         count(*) over()::bigint
  from public.search_passages p
  join public.note_versions v on v.id=p.version_id and v.status='published'
  join public.taxonomy_nodes n on n.id=p.note_id and n.deleted_at is null
  where p.scope=p_scope and (p_note_id is null or p.note_id=p_note_id)
    and (strpos(lower(p.title),lower(p_query))>0 or strpos(lower(p.content),lower(p_query))>0)
  order by similarity(p.title||' '||p.content,p_query) desc,p.id
  limit least(greatest(p_limit,1),40) offset greatest(p_offset,0);
$$;

revoke all on function public.start_note_upload(text,integer,text,uuid,jsonb) from public, anon, authenticated;
revoke all on function public.publish_note_version(text,uuid) from public, anon, authenticated;
revoke all on function public.restore_note_version(text,integer,integer) from public, anon, authenticated;
revoke all on function public.search_note_passages(text,text,text,integer,integer) from public, anon, authenticated;
grant execute on function public.start_note_upload(text,integer,text,uuid,jsonb) to service_role;
grant execute on function public.publish_note_version(text,uuid) to service_role;
grant execute on function public.restore_note_version(text,integer,integer) to service_role;
grant execute on function public.search_note_passages(text,text,text,integer,integer) to service_role;

grant all on public.taxonomy_nodes,public.note_versions,public.note_assets,public.search_passages,
  public.admin_login_attempts,public.content_events to service_role;
grant usage,select on all sequences in schema public to service_role;
