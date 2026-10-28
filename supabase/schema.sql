-- Bücher-Tracker: Datenbank-Struktur für Supabase
-- Im Supabase-Dashboard: SQL Editor > New query > alles einfügen > Run.
-- Kann gefahrlos mehrfach ausgeführt werden.

-- ===== Profile (eines pro Konto) =====
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  created_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ===== Bücher (gemeinsame Stammdaten, je ISBN einmal) =====
create table if not exists public.books (
  id uuid primary key default gen_random_uuid(),
  isbn13 text not null unique check (isbn13 ~ '^97[89][0-9]{10}$'),
  title text not null,
  subtitle text,
  authors text,
  publisher text,
  pub_year int,
  pages int check (pages is null or pages > 0),
  language text,
  categories text,
  cover_path text,          -- Pfad im Storage-Bucket "covers"
  cover_color text,         -- Rückenfarbe, aus dem Cover ermittelt (z. B. #2F5D4E)
  created_by uuid references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now()
);

-- ===== Exemplar/Eintrag je Person =====
create table if not exists public.user_books (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  book_id uuid not null references public.books(id) on delete cascade,
  status text not null default 'shelf' check (status in ('wishlist','shelf','reading','finished','abandoned')),
  format text not null default 'softcover' check (format in ('hardcover','softcover','ebook','audio')),
  rating smallint check (rating between 1 and 5),
  review text,
  notes text,
  category text,            -- eigene Kategorie/Thema der Person
  reading_series text,      -- Lesereihe (themenbezogen hintereinander gelesen)
  purchase_price numeric(8,2),
  purchase_date date,
  started_at date,
  finished_at date,
  created_at timestamptz not null default now(),
  unique (user_id, book_id)
);
create index if not exists user_books_user_idx on public.user_books(user_id, status);

-- ===== Tages-Leselog =====
create table if not exists public.reading_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  user_book_id uuid not null references public.user_books(id) on delete cascade,
  log_date date not null default current_date,
  page_to int not null check (page_to >= 0),   -- Seitenstand am Ende des Tages
  pages_read int not null default 0 check (pages_read >= 0),
  created_at timestamptz not null default now(),
  unique (user_book_id, log_date)
);
create index if not exists reading_logs_user_idx on public.reading_logs(user_id, log_date);

-- ===== Zugriffsregeln (Row Level Security) =====
alter table public.profiles enable row level security;
alter table public.books enable row level security;
alter table public.user_books enable row level security;
alter table public.reading_logs enable row level security;

-- Profile: alle Angemeldeten sehen alle, ändern nur das eigene
drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles for select to authenticated using (true);
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- Bücher (Stammdaten): lesen, anlegen und ergänzen darf jede angemeldete Person
drop policy if exists books_read on public.books;
create policy books_read on public.books for select to authenticated using (true);
drop policy if exists books_insert on public.books;
create policy books_insert on public.books for insert to authenticated with check (true);
drop policy if exists books_update on public.books;
create policy books_update on public.books for update to authenticated using (true) with check (true);

-- Einträge und Logs: alle Angemeldeten dürfen lesen, schreiben nur die eigenen
drop policy if exists ub_read on public.user_books;
create policy ub_read on public.user_books for select to authenticated using (true);
drop policy if exists ub_write on public.user_books;
create policy ub_write on public.user_books for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists rl_read on public.reading_logs;
create policy rl_read on public.reading_logs for select to authenticated using (true);
drop policy if exists rl_write on public.reading_logs;
create policy rl_write on public.reading_logs for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ===== Cover-Speicher =====
insert into storage.buckets (id, name, public)
values ('covers', 'covers', true)
on conflict (id) do nothing;

drop policy if exists covers_read on storage.objects;
create policy covers_read on storage.objects for select using (bucket_id = 'covers');
drop policy if exists covers_insert on storage.objects;
create policy covers_insert on storage.objects for insert to authenticated with check (bucket_id = 'covers');
drop policy if exists covers_update on storage.objects;
create policy covers_update on storage.objects for update to authenticated using (bucket_id = 'covers');
