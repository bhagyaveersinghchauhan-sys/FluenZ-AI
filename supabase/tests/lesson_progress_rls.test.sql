begin;

select plan(14);

insert into auth.users (
    id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
    (
        '10000000-0000-4000-8000-000000000001',
        'authenticated', 'authenticated', 'fluenz-rls-one@example.test', '',
        now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()
    ),
    (
        '20000000-0000-4000-8000-000000000002',
        'authenticated', 'authenticated', 'fluenz-rls-two@example.test', '',
        now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()
    );

insert into public.profiles (id)
values
    ('10000000-0000-4000-8000-000000000001'),
    ('20000000-0000-4000-8000-000000000002');

insert into public.lesson_progress (user_id, xp, lessons_completed)
values
    ('10000000-0000-4000-8000-000000000001', 10, 1),
    ('20000000-0000-4000-8000-000000000002', 20, 2);

insert into public.practice_sessions (
    user_id, session_id, scenario, prompt_key, completed_at, local_day
) values
    (
        '10000000-0000-4000-8000-000000000001',
        '30000000-0000-4000-8000-000000000003',
        'cafe', 'cafe_tea', now(), current_date
    ),
    (
        '20000000-0000-4000-8000-000000000002',
        '40000000-0000-4000-8000-000000000004',
        'shop', 'shop_size', now(), current_date
    );

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);

select is(
    (select count(*)::integer from public.profiles),
    1,
    'a learner only reads their own profile'
);
select is(
    (select count(*)::integer from public.lesson_progress),
    1,
    'a learner only reads their own progress'
);
select is(
    (select count(*)::integer from public.practice_sessions),
    1,
    'a learner only reads their own practice history'
);
select throws_ok(
    $$insert into public.practice_sessions (
        user_id, session_id, scenario, prompt_key, completed_at, local_day
    ) values (
        '20000000-0000-4000-8000-000000000002',
        '50000000-0000-4000-8000-000000000005',
        'cafe', 'cafe_tea', now(), current_date
    )$$,
    '42501',
    'permission denied for table practice_sessions',
    'a learner cannot insert practice history directly'
);
select is(
    public.record_practice_completion(
        '60000000-0000-4000-8000-000000000006',
        'cafe',
        'cafe_tea',
        current_date,
        now(),
        1,
        0,
        '[{"sentence":"I would like tea.","attempts":1}]'::jsonb,
        '["tea"]'::jsonb
    ),
    true,
    'the authenticated completion RPC records a new owner-bound session'
);
select is(
    public.record_practice_completion(
        '60000000-0000-4000-8000-000000000006',
        'cafe',
        'cafe_tea',
        current_date,
        now(),
        1,
        0,
        '[{"sentence":"I would like tea.","attempts":1}]'::jsonb,
        '["tea"]'::jsonb
    ),
    false,
    'a retried completion is idempotent'
);
select is(
    public.record_practice_completion(
        '70000000-0000-4000-8000-000000000007',
        'cafe',
        'cafe_tea',
        current_date,
        now(),
        0,
        0,
        '[]'::jsonb,
        '[]'::jsonb
    ),
    true,
    'a separate session on the same day is recorded'
);
select is(
    (select streak from public.lesson_progress
     where user_id = '10000000-0000-4000-8000-000000000001'),
    1,
    'multiple completed sessions on one local day count as one streak day'
);
select is(
    public.record_practice_completion(
        '80000000-0000-4000-8000-000000000008',
        'cafe',
        'cafe_tea',
        current_date - 1,
        now() - interval '1 day',
        0,
        0,
        '[]'::jsonb,
        '[]'::jsonb
    ),
    true,
    'a delayed earlier completion is recorded'
);
select is(
    (select streak from public.lesson_progress
     where user_id = '10000000-0000-4000-8000-000000000001'),
    1,
    'a delayed earlier completion does not inflate the current streak'
);
select throws_ok(
    $$insert into public.lesson_progress (user_id, xp)
      values ('20000000-0000-4000-8000-000000000002', 999)$$,
    '42501',
    'new row violates row-level security policy for table "lesson_progress"',
    'a learner cannot insert another user progress'
);
select is(
    (with changed as (
        update public.lesson_progress set xp = 999
        where user_id = '20000000-0000-4000-8000-000000000002'
        returning 1
    ) select count(*)::integer from changed),
    0,
    'a learner cannot update another user progress'
);
select is(
    (with changed as (
        update public.profiles set preferred_language = 'en'
        where id = '20000000-0000-4000-8000-000000000002'
        returning 1
    ) select count(*)::integer from changed),
    0,
    'a learner cannot update another user profile'
);
select throws_ok(
    $$insert into public.profiles (id)
      values ('20000000-0000-4000-8000-000000000002')$$,
    '42501',
    'new row violates row-level security policy for table "profiles"',
    'a learner cannot create another user profile'
);

select * from finish();
rollback;
