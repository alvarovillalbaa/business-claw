-- Reviewed source for one empty, dedicated Business Claw Postgres 17 project.
-- Apply atomically as the database administrator. This file does not execute itself.
-- No password, Data API exposure, public RPC or runtime workload grant is created.
create role bc_bff nologin noinherit nosuperuser nocreatedb nocreaterole nobypassrls;
create role bc_pool_login login noinherit nosuperuser nocreatedb nocreaterole nobypassrls;
grant bc_bff to bc_pool_login;
create schema bc_private;
revoke all on schema bc_private from public, anon, authenticated, service_role;
grant usage on schema bc_private to bc_bff;

create table bc_private.organizations (
  id uuid primary key,
  state text not null check (state in ('active','deleting','deleted')),
  revision integer not null check (revision between 0 and 1000000),
  created_by uuid not null references auth.users(id) on delete restrict,
  create_request_id uuid not null,
  request_hash text not null check (request_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null,
  updated_at timestamptz not null check (updated_at >= created_at),
  workspace jsonb not null check ((jsonb_typeof(workspace)='object'
    and workspace->>'schemaVersion'='business-claw.workspace.v1'
    and workspace#>>'{organization,id}'=id::text
    and workspace#>>'{instance,orgId}'=id::text) is true),
  unique (created_by,create_request_id)
);
create table bc_private.memberships (
  org_id uuid not null references bc_private.organizations(id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete restrict,
  role text not null check (role in ('owner','administrator','member','viewer')),
  revoked_at timestamptz,
  primary key (org_id,user_id)
);
create index bc_memberships_user on bc_private.memberships(user_id,org_id) where revoked_at is null;

create table bc_private.app_sessions (
  handle_hash text primary key check (handle_hash ~ '^[a-f0-9]{64}$'),
  user_id uuid not null references auth.users(id) on delete cascade,
  supabase_session_id uuid not null,
  authenticated_at timestamptz not null,
  expires_at timestamptz not null check (expires_at > authenticated_at and expires_at <= authenticated_at + interval '8 hours'),
  revoked_at timestamptz,
  token_revision integer not null default 0 check (token_revision between 0 and 1000000)
);
create index bc_sessions_user on bc_private.app_sessions(user_id);
create table bc_private.auth_token_envelopes (
  handle_hash text primary key references bc_private.app_sessions(handle_hash) on delete cascade,
  version smallint not null check (version=1),
  iv bytea not null check (octet_length(iv)=12),
  tag bytea not null check (octet_length(tag)=16),
  ciphertext bytea not null check (octet_length(ciphertext) between 1 and 65536)
);

create table bc_private.invites (
  id uuid primary key,
  org_id uuid not null references bc_private.organizations(id) on delete restrict,
  email text not null check (email=lower(email) and length(email) between 3 and 254),
  role text not null check (role in ('administrator','member','viewer')),
  invited_by uuid not null,
  request_hash text not null check (request_hash ~ '^[a-f0-9]{64}$'),
  token_hash text not null unique check (token_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null,
  expires_at timestamptz not null check (expires_at-created_at=interval '168 hours'),
  revoked_at timestamptz check (revoked_at is null or revoked_at >= created_at),
  accepted_by uuid,
  accepted_at timestamptz,
  accepted_revision integer,
  foreign key (org_id,invited_by) references bc_private.memberships(org_id,user_id),
  foreign key (org_id,accepted_by) references bc_private.memberships(org_id,user_id),
  check ((accepted_by is null and accepted_at is null and accepted_revision is null)
    or (accepted_by is not null and accepted_at is not null and accepted_revision is not null and accepted_revision between 1 and 1000000
      and accepted_at >= created_at and accepted_at < expires_at and revoked_at is null))
);
create index bc_invites_org on bc_private.invites(org_id);
create table bc_private.owner_transfers (
  id uuid primary key,
  org_id uuid not null references bc_private.organizations(id) on delete restrict,
  from_user_id uuid not null,
  to_user_id uuid not null check (to_user_id <> from_user_id),
  from_session_hash text not null check (from_session_hash ~ '^[a-f0-9]{64}$'),
  from_supabase_session_id uuid not null,
  from_authenticated_at timestamptz not null,
  request_hash text not null check (request_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null check (created_at >= from_authenticated_at),
  expires_at timestamptz not null check (expires_at=from_authenticated_at + interval '5 minutes' and expires_at > created_at),
  accepted_by uuid,
  accepted_at timestamptz,
  accepted_revision integer,
  foreign key (org_id,from_user_id) references bc_private.memberships(org_id,user_id),
  foreign key (org_id,to_user_id) references bc_private.memberships(org_id,user_id),
  check ((accepted_by is null and accepted_at is null and accepted_revision is null)
    or (accepted_by is not null and accepted_by=to_user_id and accepted_at is not null and accepted_revision is not null and accepted_revision between 1 and 1000000
      and accepted_at >= created_at and accepted_at < expires_at))
);
create index bc_transfers_org on bc_private.owner_transfers(org_id);
create table bc_private.audit (
  id uuid primary key,
  org_id uuid not null references bc_private.organizations(id) on delete restrict,
  actor_id uuid not null,
  session_id uuid not null,
  action text not null check (action in ('organization.bootstrap','workspace.intent','operation.request','operation.review',
    'operation.confirm','operation.cancel','invite.create','invite.accept','invite.revoke','membership.role',
    'membership.revoke','ownership.request','ownership.accept')),
  at timestamptz not null,
  metadata jsonb not null check (jsonb_typeof(metadata)='object' and octet_length(metadata::text)<=16384)
);
create index bc_audit_org_at on bc_private.audit(org_id,at,id);

revoke all on all tables in schema bc_private from public, anon, authenticated, service_role;
alter default privileges in schema bc_private revoke all on tables from public, anon, authenticated, service_role;
alter default privileges in schema bc_private revoke execute on functions from public, anon, authenticated, service_role;
grant select,insert,update on bc_private.organizations,bc_private.memberships,bc_private.app_sessions,
  bc_private.auth_token_envelopes,bc_private.invites,bc_private.owner_transfers to bc_bff;
grant select,insert on bc_private.audit to bc_bff;

-- The private BFF role owns authorization through server/policy.mjs. These policies
-- exclude browser/Data API roles; they do not authenticate a tenant or defend a
-- compromised BFF credential. No caller-supplied GUC is treated as authority.
do $$ declare t text; begin
  foreach t in array array['organizations','memberships','app_sessions','auth_token_envelopes','invites','owner_transfers','audit'] loop
    execute format('alter table bc_private.%I enable row level security',t);
    execute format('alter table bc_private.%I force row level security',t);
    execute format('create policy private_read on bc_private.%I for select to bc_bff using (true)',t);
    execute format('create policy private_insert on bc_private.%I for insert to bc_bff with check (true)',t);
    if t <> 'audit' then
      execute format('create policy private_update on bc_private.%I for update to bc_bff using (true) with check (true)',t);
    end if;
  end loop;
  execute format('grant connect on database %I to bc_pool_login',current_database());
end $$;
