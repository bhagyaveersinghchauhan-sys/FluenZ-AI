alter table public.profiles
    add column display_name text not null default 'Learner'
        check (char_length(display_name) between 1 and 80);

create table public.practice_sessions (
    user_id uuid not null references auth.users (id) on delete cascade,
    session_id uuid not null,
    scenario text not null check (
        scenario in ('cafe', 'shop', 'introduce', 'directions', 'custom')
    ),
    prompt_key text not null check (
        prompt_key in (
            'cafe_classic', 'cafe_tea', 'cafe_menu', 'cafe_bill',
            'shop_classic', 'shop_size', 'shop_payment',
            'introduce_classic', 'introduce_origin', 'introduce_work',
            'directions_classic', 'directions_bus', 'directions_landmark',
            'custom_help', 'custom_clarify'
        )
    ),
    check (
        (scenario = 'cafe' and left(prompt_key, 5) = 'cafe_')
        or (scenario = 'shop' and left(prompt_key, 5) = 'shop_')
        or (scenario = 'introduce' and left(prompt_key, 10) = 'introduce_')
        or (scenario = 'directions' and left(prompt_key, 11) = 'directions_')
        or (scenario = 'custom' and left(prompt_key, 7) = 'custom_')
    ),
    completed_at timestamptz not null,
    local_day date not null,
    failed_attempts integer not null default 0 check (failed_attempts between 0 and 99),
    hesitation_count integer not null default 0 check (hesitation_count between 0 and 999),
    difficult_sentences jsonb not null default '[]'::jsonb check (
        jsonb_typeof(difficult_sentences) = 'array'
        and jsonb_array_length(difficult_sentences) <= 10
    ),
    vocabulary_terms jsonb not null default '[]'::jsonb check (
        jsonb_typeof(vocabulary_terms) = 'array'
        and jsonb_array_length(vocabulary_terms) <= 30
    ),
    created_at timestamptz not null default now(),
    primary key (user_id, session_id)
);

alter table public.practice_sessions enable row level security;

create policy "Learners can read their own practice sessions"
    on public.practice_sessions
    for select
    to authenticated
    using ((select auth.uid()) = user_id);

create policy "Learners can delete their own practice sessions"
    on public.practice_sessions
    for delete
    to authenticated
    using ((select auth.uid()) = user_id);

revoke all on public.practice_sessions from anon, public;
grant select, delete on public.practice_sessions to authenticated;
revoke insert, update, delete on public.lesson_progress from authenticated;
grant select on public.lesson_progress to authenticated;

create or replace function public.record_practice_completion(
    p_session_id uuid,
    p_scenario text,
    p_prompt_key text,
    p_local_day date,
    p_completed_at timestamptz,
    p_failed_attempts integer,
    p_hesitation_count integer,
    p_difficult_sentences jsonb,
    p_vocabulary_terms jsonb
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
    owner_id uuid := auth.uid();
    inserted_session_id uuid;
begin
    if owner_id is null then
        raise exception 'Authentication is required.';
    end if;
    if p_session_id is null
        or p_scenario is null
        or p_scenario not in ('cafe', 'shop', 'introduce', 'directions', 'custom')
        or p_prompt_key is null
        or p_prompt_key not in (
            'cafe_classic', 'cafe_tea', 'cafe_menu', 'cafe_bill',
            'shop_classic', 'shop_size', 'shop_payment',
            'introduce_classic', 'introduce_origin', 'introduce_work',
            'directions_classic', 'directions_bus', 'directions_landmark',
            'custom_help', 'custom_clarify'
        )
        or p_local_day is null
        or p_completed_at is null
        or p_failed_attempts is null
        or p_failed_attempts not between 0 and 99
        or p_hesitation_count is null
        or p_hesitation_count not between 0 and 999
    then
        raise exception 'Practice completion data is invalid.';
    end if;
    if p_difficult_sentences is null
        or jsonb_typeof(p_difficult_sentences) is distinct from 'array'
        or p_vocabulary_terms is null
        or jsonb_typeof(p_vocabulary_terms) is distinct from 'array'
    then
        raise exception 'Practice completion data is invalid.';
    end if;
    if jsonb_array_length(p_difficult_sentences) > 10
        or jsonb_array_length(p_vocabulary_terms) > 30
    then
        raise exception 'Practice completion data is invalid.';
    end if;
    if not (
        (p_scenario = 'cafe' and left(p_prompt_key, 5) = 'cafe_')
        or (p_scenario = 'shop' and left(p_prompt_key, 5) = 'shop_')
        or (p_scenario = 'introduce' and left(p_prompt_key, 10) = 'introduce_')
        or (p_scenario = 'directions' and left(p_prompt_key, 11) = 'directions_')
        or (p_scenario = 'custom' and left(p_prompt_key, 7) = 'custom_')
    ) then
        raise exception 'Prompt does not belong to the selected scenario.';
    end if;
    if octet_length(p_difficult_sentences::text) > 16000
        or octet_length(p_vocabulary_terms::text) > 8000
    then
        raise exception 'Practice completion data is too large.';
    end if;
    if exists (
        select 1
        from jsonb_array_elements(p_difficult_sentences) as item(value)
        where jsonb_typeof(item.value) is distinct from 'object'
            or (select count(*) from jsonb_object_keys(
                case when jsonb_typeof(item.value) = 'object'
                    then item.value else '{}'::jsonb end
            )) <> 2
            or jsonb_typeof(item.value -> 'sentence') is distinct from 'string'
            or char_length(item.value ->> 'sentence') not between 1 and 200
            or jsonb_typeof(item.value -> 'attempts') is distinct from 'number'
            or (item.value ->> 'attempts') !~ '^[1-9][0-9]{0,2}$'
    ) then
        raise exception 'Difficult sentence data is invalid.';
    end if;
    if exists (
        select 1
        from jsonb_array_elements(p_vocabulary_terms) as item(value)
        where not (
            (
                jsonb_typeof(item.value) = 'string'
                and char_length(item.value #>> '{}') between 1 and 40
            )
            or (
                jsonb_typeof(item.value) = 'object'
                and (select count(*) from jsonb_object_keys(
                    case when jsonb_typeof(item.value) = 'object'
                        then item.value else '{}'::jsonb end
                )) = 4
                and item.value ?& array['term', 'definition', 'hindiMeaning', 'example']
                and jsonb_typeof(item.value -> 'term') = 'string'
                and char_length(item.value ->> 'term') between 1 and 40
                and jsonb_typeof(item.value -> 'definition') = 'string'
                and char_length(item.value ->> 'definition') <= 180
                and jsonb_typeof(item.value -> 'hindiMeaning') in ('string', 'null')
                and char_length(coalesce(item.value ->> 'hindiMeaning', '')) <= 100
                and jsonb_typeof(item.value -> 'example') in ('string', 'null')
                and char_length(coalesce(item.value ->> 'example', '')) <= 180
            )
        )
    ) then
        raise exception 'Vocabulary data is invalid.';
    end if;

    insert into public.practice_sessions (
        user_id,
        session_id,
        scenario,
        prompt_key,
        completed_at,
        local_day,
        failed_attempts,
        hesitation_count,
        difficult_sentences,
        vocabulary_terms
    ) values (
        owner_id,
        p_session_id,
        p_scenario,
        p_prompt_key,
        p_completed_at,
        p_local_day,
        p_failed_attempts,
        p_hesitation_count,
        p_difficult_sentences,
        p_vocabulary_terms
    )
    on conflict (user_id, session_id) do nothing
    returning session_id into inserted_session_id;

    if inserted_session_id is null then
        return false;
    end if;

    insert into public.lesson_progress (
        user_id,
        xp,
        streak,
        lessons_completed,
        last_active,
        updated_at
    ) values (
        owner_id,
        10,
        1,
        1,
        p_local_day,
        now()
    )
    on conflict (user_id) do update set
        xp = public.lesson_progress.xp + 10,
        lessons_completed = public.lesson_progress.lessons_completed + 1,
        streak = case
            when public.lesson_progress.last_active = p_local_day
                then public.lesson_progress.streak
            when public.lesson_progress.last_active = p_local_day - 1
                then public.lesson_progress.streak + 1
            when public.lesson_progress.last_active is null
                then 1
            when p_local_day > public.lesson_progress.last_active
                then 1
            else public.lesson_progress.streak
        end,
        last_active = greatest(
            coalesce(public.lesson_progress.last_active, p_local_day),
            p_local_day
        ),
        updated_at = now();

    return true;
end;
$$;

create or replace function public.merge_legacy_guest_progress(
    p_xp integer,
    p_lessons_completed integer,
    p_streak integer,
    p_last_active date
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    owner_id uuid := auth.uid();
begin
    if owner_id is null then
        raise exception 'Authentication is required.';
    end if;
    if p_xp is null
        or p_xp not between 0 and 2147483647
        or p_lessons_completed is null
        or p_lessons_completed not between 0 and 2147483647
        or p_streak is null
        or p_streak not between 0 and 2147483647
    then
        raise exception 'Guest progress is invalid.';
    end if;

    insert into public.lesson_progress (
        user_id,
        xp,
        streak,
        lessons_completed,
        last_active,
        updated_at
    ) values (
        owner_id,
        p_xp,
        p_streak,
        p_lessons_completed,
        p_last_active,
        now()
    )
    on conflict (user_id) do update set
        xp = greatest(public.lesson_progress.xp, excluded.xp),
        lessons_completed = greatest(
            public.lesson_progress.lessons_completed,
            excluded.lessons_completed
        ),
        streak = case
            when public.lesson_progress.last_active is null
                then excluded.streak
            when excluded.last_active is null
                then public.lesson_progress.streak
            when excluded.last_active > public.lesson_progress.last_active
                then excluded.streak
            when excluded.last_active = public.lesson_progress.last_active
                then greatest(public.lesson_progress.streak, excluded.streak)
            else public.lesson_progress.streak
        end,
        last_active = greatest(
            coalesce(public.lesson_progress.last_active, excluded.last_active),
            coalesce(excluded.last_active, public.lesson_progress.last_active)
        ),
        updated_at = now();
end;
$$;

revoke all on function public.record_practice_completion(
    uuid, text, text, date, timestamptz, integer, integer, jsonb, jsonb
) from public, anon;
grant execute on function public.record_practice_completion(
    uuid, text, text, date, timestamptz, integer, integer, jsonb, jsonb
) to authenticated;

revoke all on function public.merge_legacy_guest_progress(
    integer, integer, integer, date
) from public, anon;
grant execute on function public.merge_legacy_guest_progress(
    integer, integer, integer, date
) to authenticated;
