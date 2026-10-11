create table public.profiles (
    id uuid primary key references auth.users (id) on delete cascade,
    preferred_language text not null default 'hi'
        check (preferred_language in ('hi', 'en')),
    created_at timestamptz not null default now()
);

create table public.lesson_progress (
    user_id uuid primary key references auth.users (id) on delete cascade,
    xp integer not null default 0 check (xp >= 0),
    streak integer not null default 0 check (streak >= 0),
    lessons_completed integer not null default 0 check (lessons_completed >= 0),
    last_active date,
    updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.lesson_progress enable row level security;

create policy "Learners can read their own profile"
    on public.profiles
    for select
    to authenticated
    using ((select auth.uid()) = id);

create policy "Learners can create their own profile"
    on public.profiles
    for insert
    to authenticated
    with check ((select auth.uid()) = id);

create policy "Learners can update their own profile"
    on public.profiles
    for update
    to authenticated
    using ((select auth.uid()) = id)
    with check ((select auth.uid()) = id);

create policy "Learners can read their own lesson progress"
    on public.lesson_progress
    for select
    to authenticated
    using ((select auth.uid()) = user_id);

create policy "Learners can create their own lesson progress"
    on public.lesson_progress
    for insert
    to authenticated
    with check ((select auth.uid()) = user_id);

create policy "Learners can update their own lesson progress"
    on public.lesson_progress
    for update
    to authenticated
    using ((select auth.uid()) = user_id)
    with check ((select auth.uid()) = user_id);

revoke all on public.profiles, public.lesson_progress from anon, public;
grant select, insert, update on public.profiles, public.lesson_progress to authenticated;
