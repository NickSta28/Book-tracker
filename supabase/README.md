# Supabase-Einrichtung (Bücher-Tracker)

1. **Datenbank:** Dashboard > SQL Editor > New query > Inhalt von `schema.sql` einfügen > Run.
2. **Abfrage-Dienst:** Dashboard > Edge Functions > Deploy a new function > Via Editor.
   Name: `isbn-lookup`. Inhalt von `functions/isbn-lookup/index.ts` einfügen > Deploy.
   (JWT-Prüfung eingeschaltet lassen: nur angemeldete Personen dürfen abfragen.)
3. **Konten:** Authentication > Users > Add user (E-Mail + Passwort, „Auto Confirm User“ anhaken) für jede Person.
   Danach unter Authentication > Sign In / Providers die Option „Allow new users to sign up“ ausschalten.
4. **Optional, später:** Google-Books-Schlüssel als Secret `GOOGLE_BOOKS_KEY` (Edge Functions > Secrets).

`functions/isbn-lookup/index.ts` wird mit `build.sh` aus `parse.js` und `handler.ts` erzeugt.
