-- ============================================================================
-- Fiberlytic Multi-Tenant Backend — Phase 1: Foundation
-- ============================================================================
-- Two-level tenancy: `organizations` is the SaaS-tenant boundary (one prime
-- contractor company, e.g. "NextGen Fiber LLC"). `subcontractors` are
-- companies *within* one organization that get their own restricted logins.
-- A work-owning row's "company type" is never stored — it's derived from
-- whether subcontractor_id is null (in-house) or set (that subcontractor's).
--
-- SAFETY CONSTRAINT (see project plan): this migration covers only the
-- ownership backbone (organizations/profiles/subcontractors/employees/
-- projects). fieldMarkups/markupBilling/production/pnl/notifications remain
-- on unscoped shared localStorage until Phase 2. Do NOT onboard a second
-- organization or issue any subcontractor-tier login until Phase 2 ships —
-- until then this migration only supports internal/single-tenant use.
--
-- Conventions (matching the existing supabase/schema.sql precedent):
-- text primary keys (app-generated, not uuid — every FK across the app's
-- ~27 existing collections is already a plain string), snake_case, jsonb
-- for nested/structured data, timestamptz default now() for audit columns.
-- The one deliberate exception is profiles.id, which IS a uuid because it
-- must equal Supabase's auth.users.id.
-- ============================================================================

-- ── organizations ────────────────────────────────────────────────────────
-- The SaaS-tenant root. No self-serve creation in Phase 1 (see RLS below,
-- intentionally no INSERT policy) — new organizations are provisioned by a
-- human via the Supabase SQL editor / service role until an onboarding flow
-- exists. This is a deliberate lockdown, not an oversight.
create table organizations (
  id text primary key,
  name text not null,
  active boolean not null default true,
  created_by text,
  created_at timestamptz not null default now(),
  updated_by text,
  updated_at timestamptz not null default now()
);

-- ── subcontractors ───────────────────────────────────────────────────────
-- Mirrors src/types.ts's Subcontractor interface, + organization_id.
create table subcontractors (
  id text primary key,
  organization_id text not null references organizations(id),
  company_name text not null,
  contact_name text,
  phone text,
  email text,
  rate_card_id text,
  insurance_expires_at date,
  insurance_notes text,
  active boolean not null default true,
  notes text,
  created_by text,
  created_at timestamptz not null default now(),
  updated_by text,
  updated_at timestamptz not null default now()
);
create index idx_subcontractors_org on subcontractors(organization_id);

-- ── employees ─────────────────────────────────────────────────────────────
-- Mirrors src/types.ts's Employee interface, + organization_id AND a
-- nullable subcontractor_id: a subcontractor has their own employees too
-- (spec section 1: "Their employees"), not just the prime's in-house staff.
-- null subcontractor_id = in-house employee; set = that subcontractor's own.
--
-- The TS type's `role` field (free-text job title like "Driller", "Locator")
-- is renamed to job_title here — kept identical in spelling to profiles.role
-- (the RBAC role) would be a real foot-gun in RLS policies and joins across
-- this schema. DataContext's mapping layer does the one-line translation.
create table employees (
  id text primary key,
  organization_id text not null references organizations(id),
  subcontractor_id text references subcontractors(id),
  name text not null,
  job_title text not null,
  hourly_rate numeric not null default 0,
  default_crew_id text,
  active boolean not null default true,
  is_foreman boolean not null default false,
  created_by text,
  created_at timestamptz not null default now(),
  updated_by text,
  updated_at timestamptz not null default now()
);
create index idx_employees_org_sub on employees(organization_id, subcontractor_id);

-- ── profiles ──────────────────────────────────────────────────────────────
-- 1:1 with the authenticated user — the RBAC anchor every RLS policy reads.
-- role is text + check, not a Postgres enum: two more roles (customer,
-- qa_qc_inspector) are already known to be coming, and enums are awkward to
-- extend/reorder later.
--
-- organization_id and role are NULLABLE — a brand-new signup gets a bare
-- profiles row (created by the client's "ensure profile exists" step on
-- first login) with neither set yet, since there's no self-serve onboarding
-- in Phase 1. An admin assigns both by hand (see the bootstrapping comment
-- at the bottom of this file). Every RLS policy in this file already treats
-- current_org_id()/current_role_name() returning NULL correctly: an
-- unassigned user's own profile row is still visible to them (profiles_select
-- checks id = auth.uid() first), but they match zero rows anywhere else,
-- since `organization_id = NULL` and `role = NULL` never satisfy an equality
-- check — i.e. an unassigned account is safely locked out of everything
-- until an admin configures it, which is the correct default-deny posture.
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  organization_id text references organizations(id),
  role text check (role in (
    'system_administrator', 'company_administrator', 'project_manager', 'supervisor',
    'in_house_crew', 'field_employee',
    'subcontractor_administrator', 'subcontractor_crew_leader', 'subcontractor_employee',
    'customer', 'qa_qc_inspector'
  )),
  subcontractor_id text references subcontractors(id),
  employee_id text references employees(id),
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Data-integrity guardrail, not just an app-layer rule: a subcontractor-tier
  -- role with a NULL subcontractor_id would be treated as "sees everything in
  -- the org" by every RLS policy below (current_subcontractor_id() IS NULL
  -- means "not subcontractor-scoped") — that's a real security hole, not a
  -- cosmetic bug, so it's enforced at the schema level. An unassigned (role
  -- IS NULL) profile is exempt — it isn't subcontractor-tier or anything
  -- else yet.
  constraint subcontractor_role_requires_subcontractor_id check (
    role is null
    or (role in ('subcontractor_administrator', 'subcontractor_crew_leader', 'subcontractor_employee')
      and subcontractor_id is not null)
    or (role not in ('subcontractor_administrator', 'subcontractor_crew_leader', 'subcontractor_employee')
      and subcontractor_id is null)
  )
);
create index idx_profiles_org on profiles(organization_id);
create index idx_profiles_subcontractor on profiles(subcontractor_id);

-- ── projects ──────────────────────────────────────────────────────────────
-- Mirrors src/types.ts's Project interface, + organization_id. A project has
-- no single subcontractor_id of its own — one project can involve several
-- subcontractors simultaneously (spec section 3's example: Project ABC has
-- In-House Crew A/B + Subcontractor Alpha + Subcontractor Bravo all on one
-- job) — so project-level subcontractor visibility is a many-to-many
-- relationship, handled by project_subcontractor_assignments below, not a
-- column on this table.
create table projects (
  id text primary key,
  organization_id text not null references organizations(id),
  name text not null,
  client text not null,
  client_id text,
  rate_card_id text,
  boundary jsonb,
  location text not null,
  status text not null,
  work_types text[] not null default '{}',
  start_date date not null,
  due_date date not null,
  contract_value numeric not null default 0,
  budget numeric not null default 0,
  footage_goal numeric not null default 0,
  footage_complete numeric not null default 0,
  crew_ids text[] not null default '{}',
  retention_pct numeric,
  notes text,
  created_by text,
  created_at timestamptz not null default now(),
  updated_by text,
  updated_at timestamptz not null default now()
);
create index idx_projects_org on projects(organization_id);

-- ── project_subcontractor_assignments ────────────────────────────────────
-- "Their assigned projects" (spec section 1) — a subcontractor only sees a
-- project once assigned here. Only prime-side roles create assignments
-- (see RLS below); subcontractors cannot self-assign to a project.
create table project_subcontractor_assignments (
  id text primary key,
  organization_id text not null references organizations(id),
  project_id text not null references projects(id) on delete cascade,
  subcontractor_id text not null references subcontractors(id) on delete cascade,
  assigned_at timestamptz not null default now(),
  assigned_by text,
  unique (project_id, subcontractor_id)
);
create index idx_psa_org on project_subcontractor_assignments(organization_id);
create index idx_psa_project on project_subcontractor_assignments(project_id);
create index idx_psa_subcontractor on project_subcontractor_assignments(subcontractor_id);

-- ============================================================================
-- RLS helper functions
-- ============================================================================
-- STABLE + SECURITY DEFINER + explicit search_path (an unset search_path on
-- a SECURITY DEFINER function is a real privilege-escalation vector — a
-- caller with a hostile search_path could get it to resolve to a shadow
-- table). Callers wrap these as `(select fn())` in policies, not bare calls —
-- that lets Postgres evaluate once per statement (an InitPlan) instead of
-- once per row, which matters at "thousands of users" scale.

create or replace function current_org_id()
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select organization_id from public.profiles where id = auth.uid();
$$;

create or replace function current_subcontractor_id()
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select subcontractor_id from public.profiles where id = auth.uid();
$$;

create or replace function current_role_name()
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select role from public.profiles where id = auth.uid();
$$;
-- Named current_role_name(), not current_role() — `current_role` is a
-- reserved Postgres keyword/session variable; shadowing it is asking for a
-- confusing bug later.

-- ============================================================================
-- Row Level Security
-- ============================================================================

alter table organizations enable row level security;
alter table subcontractors enable row level security;
alter table employees enable row level security;
alter table profiles enable row level security;
alter table projects enable row level security;
alter table project_subcontractor_assignments enable row level security;

-- system_administrator is a platform-wide role (the SaaS operator's own
-- staff), distinct from company_administrator (a customer's own admin,
-- scoped to their one org) — every policy below gives it a cross-org bypass.

-- organizations: see your own org only. No INSERT/UPDATE/DELETE policy
-- exists (deliberately) — org provisioning is service-role/SQL-editor only
-- in Phase 1, which is what makes "no self-serve onboarding yet" a real
-- enforced constraint rather than just a documented one.
create policy organizations_select on organizations
  for select using (
    (select current_role_name()) = 'system_administrator'
    or id = (select current_org_id())
  );

-- subcontractors: prime-side roles (current_subcontractor_id() IS NULL) see
-- every subcontractor in their org; a subcontractor-tier user sees only
-- their own row — never another subcontractor's existence, per spec section 1.
create policy subcontractors_select on subcontractors
  for select using (
    (select current_role_name()) = 'system_administrator'
    or (
      organization_id = (select current_org_id())
      and (
        (select current_subcontractor_id()) is null
        or id = (select current_subcontractor_id())
      )
    )
  );
create policy subcontractors_insert on subcontractors
  for insert with check (
    organization_id = (select current_org_id())
    and (select current_subcontractor_id()) is null
  );
create policy subcontractors_update on subcontractors
  for update using (
    organization_id = (select current_org_id())
    and (
      (select current_subcontractor_id()) is null
      or id = (select current_subcontractor_id())  -- a subcontractor admin may edit their own company's contact info
    )
  )
  with check (
    organization_id = (select current_org_id())
    and (
      (select current_subcontractor_id()) is null
      or id = (select current_subcontractor_id())
    )
  );
create policy subcontractors_delete on subcontractors
  for delete using (
    organization_id = (select current_org_id())
    and (select current_subcontractor_id()) is null
  );

-- employees: standard two-level tenancy scoping (org match + subcontractor
-- null-or-match). Subcontractor-tier users may manage their own crew's
-- employee records; prime-side roles manage in-house + can see every
-- subcontractor's roster within their org (needed for the admin unified view).
create policy employees_select on employees
  for select using (
    (select current_role_name()) = 'system_administrator'
    or (
      organization_id = (select current_org_id())
      and (
        (select current_subcontractor_id()) is null
        or subcontractor_id = (select current_subcontractor_id())
      )
    )
  );
create policy employees_insert on employees
  for insert with check (
    organization_id = (select current_org_id())
    and (
      (select current_subcontractor_id()) is null
      or subcontractor_id = (select current_subcontractor_id())
    )
  );
create policy employees_update on employees
  for update using (
    organization_id = (select current_org_id())
    and (
      (select current_subcontractor_id()) is null
      or subcontractor_id = (select current_subcontractor_id())
    )
  )
  with check (
    organization_id = (select current_org_id())
    and (
      (select current_subcontractor_id()) is null
      or subcontractor_id = (select current_subcontractor_id())
    )
  );
create policy employees_delete on employees
  for delete using (
    organization_id = (select current_org_id())
    and (
      (select current_subcontractor_id()) is null
      or subcontractor_id = (select current_subcontractor_id())
    )
  );

-- profiles: everyone can read their own row (needed to bootstrap the app —
-- current_org_id() etc. depend on this being readable); prime-side admins
-- can see every profile in their org (needed to assign roles). No one can
-- write profiles from the client in Phase 1 — role assignment happens via
-- the Supabase SQL editor / service role until an admin UI exists, so a
-- compromised or buggy client can never grant itself a higher role.
create policy profiles_select on profiles
  for select using (
    id = auth.uid()
    or (select current_role_name()) = 'system_administrator'
    or (
      organization_id = (select current_org_id())
      and (select current_subcontractor_id()) is null
    )
  );

-- A user may create only their own bare placeholder row (id = auth.uid()),
-- and only unassigned (organization_id/role both NULL) — self-granting an
-- org or role on insert is blocked here, not just left to app-layer trust.
create policy profiles_insert_self on profiles
  for insert with check (
    id = auth.uid()
    and organization_id is null
    and role is null
  );

-- projects: prime-side roles see every project in their org. A
-- subcontractor-tier user sees only projects they've been explicitly
-- assigned via project_subcontractor_assignments.
create policy projects_select on projects
  for select using (
    (select current_role_name()) = 'system_administrator'
    or (
      organization_id = (select current_org_id())
      and (
        (select current_subcontractor_id()) is null
        or exists (
          select 1 from project_subcontractor_assignments psa
          where psa.project_id = projects.id
            and psa.subcontractor_id = (select current_subcontractor_id())
        )
      )
    )
  );
create policy projects_insert on projects
  for insert with check (
    organization_id = (select current_org_id())
    and (select current_subcontractor_id()) is null
  );
create policy projects_update on projects
  for update using (
    organization_id = (select current_org_id())
    and (select current_subcontractor_id()) is null
  )
  with check (
    organization_id = (select current_org_id())
    and (select current_subcontractor_id()) is null
  );
create policy projects_delete on projects
  for delete using (
    organization_id = (select current_org_id())
    and (select current_subcontractor_id()) is null
  );

-- project_subcontractor_assignments: subcontractors can see which of their
-- own assignments exist (so they know which projects they're on); only
-- prime-side roles create/remove assignments — a subcontractor can never
-- assign itself to a project.
create policy psa_select on project_subcontractor_assignments
  for select using (
    (select current_role_name()) = 'system_administrator'
    or (
      organization_id = (select current_org_id())
      and (
        (select current_subcontractor_id()) is null
        or subcontractor_id = (select current_subcontractor_id())
      )
    )
  );
create policy psa_insert on project_subcontractor_assignments
  for insert with check (
    organization_id = (select current_org_id())
    and (select current_subcontractor_id()) is null
  );
create policy psa_delete on project_subcontractor_assignments
  for delete using (
    organization_id = (select current_org_id())
    and (select current_subcontractor_id()) is null
  );

-- ============================================================================
-- Bootstrapping the first organization (run once, manually, after applying
-- this migration — there is no self-serve flow yet, by design):
--
--   insert into organizations (id, name) values ('org-nextgen', 'NextGen Fiber LLC');
--
--   -- After the first user signs up through the app (which creates an
--   -- auth.users row + an empty-role profile via the client's "ensure
--   -- profile exists" step), promote them by hand:
--   update profiles set organization_id = 'org-nextgen', role = 'company_administrator'
--   where id = '<their auth.users.id>';
-- ============================================================================
