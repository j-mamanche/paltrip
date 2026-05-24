create type member_status as enum ('pending', 'active', 'removed');

alter table trip_users add column status member_status not null default 'active';

create index on trip_users (trip_id, status);
