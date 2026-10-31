-- Additive journal for the separately bound deployment worker; no job or authority is created.
create role bc_runtime_worker nologin noinherit nosuperuser nocreatedb nocreaterole nobypassrls;
create role bc_runtime_login login noinherit nosuperuser nocreatedb nocreaterole nobypassrls;
grant bc_runtime_worker to bc_runtime_login;
grant usage on schema bc_private to bc_runtime_worker;

create table bc_private.runtime_operations (
  operation_id uuid primary key,
  request_id uuid not null unique,
  org_id uuid not null references bc_private.organizations(id) on delete restrict,
  request_hash text not null check(request_hash ~ '^[a-f0-9]{64}$'),
  fence bigint not null check(fence between 1 and 9007199254740991),
  revision bigint not null check(revision between 1 and 9007199254740991),
  receipt jsonb not null check((jsonb_typeof(receipt)='object'
    and octet_length(receipt::text)<=32768
    and receipt->>'operationId'=operation_id::text
    and receipt->>'requestId'=request_id::text
    and receipt#>>'{binding,orgId}'=org_id::text
    and receipt->>'requestHash'=request_hash
    and (receipt->>'fence')::numeric=fence
    and (receipt->>'revision')::numeric=revision
    and receipt->>'action' in ('create','poweron','shutdown','delete')
    and receipt->>'state' in ('reserved','uncertain','pending','succeeded','failed')) is true),
  created_at timestamptz not null,
  updated_at timestamptz not null check(updated_at>=created_at),
  check(((receipt->>'observedAt')::timestamptz=updated_at) is true)
);
create index bc_runtime_operations_org on bc_private.runtime_operations(org_id,operation_id);

create table bc_private.runtime_operation_events (
  operation_id uuid not null references bc_private.runtime_operations(operation_id) on delete restrict,
  fence bigint not null check(fence between 1 and 9007199254740991),
  revision bigint not null check(revision between 1 and 9007199254740991),
  receipt jsonb not null check((jsonb_typeof(receipt)='object'
    and octet_length(receipt::text)<=32768
    and receipt->>'operationId'=operation_id::text
    and (receipt->>'fence')::numeric=fence
    and (receipt->>'revision')::numeric=revision) is true),
  observed_at timestamptz not null,
  primary key(operation_id,revision),
  check(((receipt->>'observedAt')::timestamptz=observed_at) is true)
);

revoke all on bc_private.runtime_operations,bc_private.runtime_operation_events
  from public,anon,authenticated,service_role,bc_bff,bc_pool_login;
grant select,insert,update on bc_private.runtime_operations to bc_runtime_worker;
grant select,insert on bc_private.runtime_operation_events to bc_runtime_worker;
alter table bc_private.runtime_operations enable row level security;
alter table bc_private.runtime_operations force row level security;
alter table bc_private.runtime_operation_events enable row level security;
alter table bc_private.runtime_operation_events force row level security;
create policy runtime_read on bc_private.runtime_operations for select to bc_runtime_worker using(true);
create policy runtime_insert on bc_private.runtime_operations for insert to bc_runtime_worker with check(true);
create policy runtime_update on bc_private.runtime_operations for update to bc_runtime_worker using(true) with check(true);
create policy runtime_event_read on bc_private.runtime_operation_events for select to bc_runtime_worker using(true);
create policy runtime_event_append on bc_private.runtime_operation_events for insert to bc_runtime_worker with check(true);
do $$ begin execute format('grant connect on database %I to bc_runtime_login',current_database()); end $$;
