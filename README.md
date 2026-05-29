# PDF Map Pins

A small single-page app for loading a PDF map, zooming around it, dropping pins, and saving those pins in Supabase.

## What to wire in Supabase

Create a table named `map_pins` with this shape:

```sql
create table if not exists public.map_pins (
  id uuid primary key,
  document_id text not null,
  page_number integer not null,
  label text not null,
  color text not null,
  x_percent numeric not null,
  y_percent numeric not null,
  created_at timestamptz not null default now()
);

alter table public.map_pins enable row level security;

create policy "Allow read access to map pins"
  on public.map_pins
  for select
  using (true);

create policy "Allow insert access to map pins"
  on public.map_pins
  for insert
  with check (true);

create policy "Allow delete access to map pins"
  on public.map_pins
  for delete
  using (true);
```

Then create a local `config.js` file next to `index.html` with your Supabase values:

```js
window.SUPABASE_URL = 'https://your-project.supabase.co';
window.SUPABASE_ANON_KEY = 'your-anon-public-key';
```

You can copy `config.example.js` to `config.js` and fill it in locally. Do not commit `config.js`.

If you prefer, you can also inject the same values from your hosting platform during deployment.

The app reads those values before `app.js` runs.

## Deploying it

This repo is static HTML/CSS/JS, so the fastest hosting options are Netlify, Vercel, or GitHub Pages.

Recommended path:

1. Push the repo to GitHub.
2. Deploy the repo root as a static site on Netlify or Vercel.
3. Add your Supabase URL and anon key in `app.js`.
4. Create the `map_pins` table above.
5. Open the deployed URL and test loading a PDF, dropping a pin, and refreshing the page.

## Notes

The app uses Supabase for pin persistence, but it falls back to browser `localStorage` if Supabase is not configured yet. That makes local testing easier before you publish it.
