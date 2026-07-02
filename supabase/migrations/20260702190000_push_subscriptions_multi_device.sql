-- Allow multiple simultaneous push subscriptions per user (one per device).
-- Previously unique on user_id alone, which meant enabling notifications on a
-- second device silently overwrote the first device's subscription.
alter table public.push_subscriptions drop constraint if exists push_subscriptions_user_id_key;
alter table public.push_subscriptions add constraint push_subscriptions_user_endpoint_key unique (user_id, endpoint);
