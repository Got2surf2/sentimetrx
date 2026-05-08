-- 040_deck_download_log.sql
-- Tracks every investor / strategy deck download so /admin/decks can show
-- "last downloaded" beside each card. Fire-and-forget insert from the
-- admin-gated PPTX generation routes.

CREATE TABLE IF NOT EXISTS public.deck_download_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deck_name       TEXT NOT NULL,
  deck_variant    TEXT,
  user_id         UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  org_id          UUID REFERENCES organizations(id) ON DELETE SET NULL,
  downloaded_at   TIMESTAMPTZ DEFAULT now()
);

-- Latest-per-deck lookups for the admin page
CREATE INDEX IF NOT EXISTS idx_deck_download_log_recent
  ON public.deck_download_log(deck_name, downloaded_at DESC);

-- Service-role writes only; admin reads via app-layer auth check.
ALTER TABLE public.deck_download_log ENABLE ROW LEVEL SECURITY;
-- No policies — service role bypasses RLS.
