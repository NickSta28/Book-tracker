#!/bin/sh
# Erzeugt index.ts (eine Datei zum Einfügen im Supabase-Dashboard)
cd "$(dirname "$0")"
{ echo "// Automatisch erzeugt aus parse.js + handler.ts (siehe build.sh). Nicht von Hand ändern."; sed 's/^export //' parse.js; cat handler.ts; } > index.ts
