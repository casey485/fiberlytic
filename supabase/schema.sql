-- Fiberlytic — PDF Print Reader + KMZ Builder
-- Run this in the Supabase SQL editor to create the tables the app upserts into.
-- Matches the row shapes in src/features/printkmz/supabase.ts.

create table if not exists print_sessions (
  id           text primary key,
  file_name    text not null,
  project_name text,
  city         text,
  county       text,
  state        text,
  page_count   int,
  center_lng   double precision,
  center_lat   double precision,
  extraction   jsonb,
  legend       jsonb,
  created_at   timestamptz default now()
);

create table if not exists print_objects (
  id                  text primary key,
  session_id          text references print_sessions(id) on delete cascade,
  type                text not null,
  label               text,
  status              text,
  lng                 double precision,
  lat                 double precision,
  path                jsonb,
  feeder              text,
  section             text,
  fiber_count         int,
  footage             double precision,
  span_length         double precision,
  construction_method text,
  road_name           text,
  sheet               text,
  notes               text,
  confidence          double precision,
  photos              jsonb default '[]'::jsonb,
  redlines            jsonb default '[]'::jsonb,
  production_quantity double precision,
  billing_quantity    double precision,
  crew_assignment     text,
  created_at          timestamptz default now(),
  updated_at          timestamptz default now()
);

create index if not exists print_objects_session_idx on print_objects (session_id);
create index if not exists print_objects_type_idx on print_objects (type);
create index if not exists print_objects_feeder_idx on print_objects (feeder);

-- NOTE: with the anon key the app writes directly from the browser. For a real
-- deployment, enable Row Level Security and add policies scoped to authenticated
-- users / your org before exposing this beyond local use:
--
-- alter table print_sessions enable row level security;
-- alter table print_objects  enable row level security;
-- (then create policies appropriate to your auth model)
