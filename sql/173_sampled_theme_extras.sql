-- sql/173_sampled_theme_extras.sql
-- Brief E item 2 (PERFORMANCE_REVIEW.md §7 / §2) — the three theme-card "extras"
-- on the /theme-counts route (cooccurrence matrix, topical words, per-theme
-- Dimensions) each full-scan `dataset_rows_flat` per member and 57014 at ~1M
-- (deferred by sql/170 as "not the reported bug"; closed here). Each gets a
-- keyset-paged multi-theme twin over the deterministic 50K idx_drf_sample
-- (sql/160) returning ONE page's partial aggregate as jsonb; the caller
-- (lib/sampledThemeExtras.ts) pages to the cap, merges partials, and scales
-- counts by total/scanned. Multi-theme in one pass (all themes per page call)
-- so a member needs ~10 page calls, not ~10×N. Used above the 50K cap where the
-- exact RPCs 57014; below the cap the route calls the exact RPCs unchanged.
--
-- A single-call sample aggregation is NOT viable: selecting the 50K sample and
-- heap-fetching each row's full `data` jsonb runs ~30s at 1M (the review's "50K
-- sample load ~44-56s" caveat), so paging (5000-row pages, each well under the
-- 8s statement timeout) is mandatory — same reason sql/162/169/171 page.
--
-- The keyset page CTE is byte-identical to sample_dataset_rows / sql/169/171 so
-- the planner uses idx_drf_sample. SECURITY DEFINER over raw rows ->
-- service_role only (matches the exact RPCs sql/054/055/151 + the sampled
-- family); routes enforce org access.

BEGIN;

-- Shared canonical stopword + sentiment-adjective list for topical extraction,
-- extracted from sql/054's inline NOT IN list so the exact and sampled paths
-- share ONE source (the list was previously duplicated with a "keep in sync"
-- comment). IMMUTABLE so the planner folds it.
CREATE OR REPLACE FUNCTION topical_stopwords()
RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
  SELECT ARRAY[
'a','an','the','this','that','these','those',
'i','me','my','mine','we','us','our','ours','you','your','yours','he','him','his','she','her','hers','it','its','they','them','their','theirs','myself','yourself','itself','themselves',
'is','are','was','were','be','been','being','am','have','has','had','do','does','did','done','doing','will','would','should','could','can','may','might','must','shall',
'get','got','gets','getting','go','goes','went','going','gone','come','came','comes','coming','make','made','makes','making','take','took','takes','taking','give','gave','gives','giving','say','said','says','saying','see','saw','sees','seeing','seen','know','knew','knows','knowing','known','think','thought','thinks','thinking','feel','felt','feels','want','wanted','wants','need','needed','needs','try','tried','tries','use','used','uses','find','found','finds','put','puts','let','lets','keep','kept','keeps','seem','seemed','seems','look','looked','looks','looking','tell','told','tells','telling','ask','asked','asks','asking','show','showed','shows','call','called','calls','calling',
'in','on','at','to','for','of','with','by','from','about','as','into','through','onto','upon','over','under','between','after','before','during','since','until','while','within','without','around','near',
'and','or','nor','but','so','because','if','when','then','than','though','although','however','also','plus','yet','still','either','neither','whether',
'very','really','quite','just','too','still','even','only','always','never','sometimes','often','rarely','usually','almost','nearly','already','probably','definitely','actually','basically','literally','barely','simply','exactly','especially',
'highly','absolutely','completely','totally','extremely','incredibly','remarkably','thoroughly','truly','genuinely','particularly','specifically','consistently','frequently','occasionally','constantly','perfectly','utterly','fully','entirely','clearly','obviously','certainly','surely','strongly','heavily','deeply','widely',
'here','there','where','everywhere','anywhere','somewhere','now','today','tonight','tomorrow','yesterday','soon','later','earlier','ever',
'how','what','which','who','whom','whose','why',
'all','some','any','many','much','more','most','less','least','few','several','enough','little','lot','lots',
'other','others','another','same','different','similar','such','own','new','old','first','last','next','recent',
'not','no','yes','none','nothing','anything','something','everything',
'one','two','three','four','five','six','seven','eight','nine','ten','time','times','day','days','night','nights','minute','minutes','hour','hours','week','weeks','month','months','year','years',
'way','ways','thing','things','place','people','person','someone','everyone','anyone',
'back','again','ago',
'good','great','excellent','amazing','awesome','fantastic','wonderful','perfect','best','delicious','tasty','fresh','friendly','nice','lovely','clean','quick','fast','warm','crispy','tender','flavorful','juicy','rich','creamy','attentive','helpful','polite','outstanding','superb','incredible','comfortable','cozy','pleasant','enjoyable','reasonable','generous','authentic','exceptional','satisfying','refreshing','favorite','love','loved','recommend',
'bad','terrible','horrible','awful','worst','poor','slow','cold','bland','dry','stale','rude','dirty','expensive','overpriced','small','loud','noisy','crowded','long','soggy','burnt','undercooked','overcooked','raw','greasy','salty','bitter','tasteless','mediocre','disappointing','disgusting','uncomfortable','unfriendly','unprofessional','filthy','gross','lukewarm','watery','tough','chewy','rubbery','hard','wrong','missing','broken','ignored','waited','annoyed','frustrated','underwhelming','overrated'
  ]::text[];
$$;

-- 1. cooccurrence page — pair counts among themes co-matched in each page row --
CREATE OR REPLACE FUNCTION sampled_theme_cooccurrence_page(
  p_dataset_id uuid,
  p_field_keys text[],
  p_themes     jsonb,   -- [{ "id": "...", "keywords": ["kw", ...] }, ...] (keywords pre-fragmented by caller)
  p_after_hash bigint,
  p_after_id   bigint,
  p_limit      int
)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH page AS MATERIALIZED (
    SELECT f.id, f.data,
           (('x' || substr(md5(f.id::text || f.dataset_id::text), 1, 8))::bit(32)::bigint) AS h
    FROM dataset_rows_flat f
    WHERE f.dataset_id = p_dataset_id
      AND ( (('x' || substr(md5(f.id::text || f.dataset_id::text), 1, 8))::bit(32)::bigint), f.id )
          > (p_after_hash, p_after_id)
    ORDER BY (('x' || substr(md5(f.id::text || f.dataset_id::text), 1, 8))::bit(32)::bigint), f.id
    LIMIT p_limit
  ),
  tp AS (
    SELECT (theme->>'id') AS tid,
           '\m(' || (SELECT string_agg(kw, '|') FROM jsonb_array_elements_text(theme->'keywords') AS kw WHERE kw <> '') || ')' AS pat
    FROM jsonb_array_elements(p_themes) AS theme
    WHERE jsonb_array_length(theme->'keywords') > 0
  ),
  rc AS (
    SELECT page.id, string_agg(coalesce(page.data ->> k, ''), ' ') AS combined
    FROM page, unnest(p_field_keys) AS k
    GROUP BY page.id
  ),
  rt AS (
    SELECT rc.id, array_agg(tp.tid) AS tids
    FROM rc JOIN tp ON rc.combined ~* tp.pat
    GROUP BY rc.id HAVING count(*) >= 2
  ),
  pc AS (
    SELECT a AS ta, b AS tb, count(*)::bigint AS n
    FROM rt, LATERAL unnest(tids) AS a, LATERAL unnest(tids) AS b
    WHERE a <> b GROUP BY a, b
  )
  SELECT jsonb_build_object(
    'n_scanned', (SELECT count(*) FROM page),
    'pairs',     COALESCE((SELECT jsonb_agg(jsonb_build_array(ta, tb, n)) FROM pc), '[]'::jsonb),
    'last_hash', (SELECT h  FROM page ORDER BY h DESC, id DESC LIMIT 1),
    'last_id',   (SELECT id FROM page ORDER BY h DESC, id DESC LIMIT 1)
  );
$$;

-- 2. topical page — per-theme ±2-window word counts (multi-theme, one pass) ----
CREATE OR REPLACE FUNCTION sampled_theme_topical_page(
  p_dataset_id     uuid,
  p_field_keys     text[],
  p_themes         jsonb,   -- [{ "id", "keywords":[raw kw,...] }] (raw, NOT fragmented — matches extract_theme_topical_words)
  p_extra_excludes text[],
  p_after_hash     bigint,
  p_after_id       bigint,
  p_limit          int
)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH page AS MATERIALIZED (
    SELECT f.id, f.data,
           (('x' || substr(md5(f.id::text || f.dataset_id::text), 1, 8))::bit(32)::bigint) AS h
    FROM dataset_rows_flat f
    WHERE f.dataset_id = p_dataset_id
      AND ( (('x' || substr(md5(f.id::text || f.dataset_id::text), 1, 8))::bit(32)::bigint), f.id )
          > (p_after_hash, p_after_id)
    ORDER BY (('x' || substr(md5(f.id::text || f.dataset_id::text), 1, 8))::bit(32)::bigint), f.id
    LIMIT p_limit
  ),
  tp AS (
    SELECT (theme->>'id') AS tid,
           '\m(' || (SELECT string_agg(kw, '|') FROM jsonb_array_elements_text(theme->'keywords') AS kw WHERE kw <> '') || ')' AS pat
    FROM jsonb_array_elements(p_themes) AS theme
    WHERE jsonb_array_length(theme->'keywords') > 0
  ),
  row_text AS (
    SELECT page.id, string_agg(lower(coalesce(page.data ->> k, '')), ' ') AS combined
    FROM page, unnest(p_field_keys) AS k
    GROUP BY page.id
  ),
  tokens AS (
    SELECT rt.id, tk.word, tk.pos
    FROM row_text rt,
         LATERAL unnest(regexp_split_to_array(rt.combined, '[^a-z0-9'']+')) WITH ORDINALITY AS tk(word, pos)
    WHERE tk.word IS NOT NULL AND tk.word != ''
  ),
  kw_positions AS (   -- token positions where each theme's keywords hit
    SELECT tp.tid, tp.pat, t.id, t.pos
    FROM tokens t JOIN tp ON t.word ~* tp.pat
  ),
  window_words AS (   -- ±2 window per (theme, keyword-hit), excluding the hit position
    SELECT kp.tid, kp.pat, t.word
    FROM tokens t
    JOIN kw_positions kp ON t.id = kp.id
    WHERE t.pos BETWEEN kp.pos - 2 AND kp.pos + 2 AND t.pos <> kp.pos
  ),
  filtered AS (
    SELECT tid, word, count(*)::bigint AS cnt
    FROM window_words ww
    WHERE length(word) >= 3
      AND word !~ '^[0-9]+$'
      AND word !~* ww.pat                          -- exclude that theme's own keyword stems
      AND NOT (word = ANY(p_extra_excludes))
      AND NOT (word = ANY(topical_stopwords()))
    GROUP BY tid, word
  )
  SELECT jsonb_build_object(
    'n_scanned', (SELECT count(*) FROM page),
    'words',     COALESCE((SELECT jsonb_agg(jsonb_build_array(tid, word, cnt)) FROM filtered), '[]'::jsonb),
    'last_hash', (SELECT h  FROM page ORDER BY h DESC, id DESC LIMIT 1),
    'last_id',   (SELECT id FROM page ORDER BY h DESC, id DESC LIMIT 1)
  );
$$;

-- 3. dimension page — per-theme (axis, sub) counts over the _tx blob ----------
CREATE OR REPLACE FUNCTION sampled_theme_dimension_page(
  p_dataset_id uuid,
  p_field_keys text[],
  p_themes     jsonb,   -- [{ "id", "keywords":[fragmented kw,...] }]
  p_after_hash bigint,
  p_after_id   bigint,
  p_limit      int
)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH page AS MATERIALIZED (
    SELECT f.id, f.data,
           (('x' || substr(md5(f.id::text || f.dataset_id::text), 1, 8))::bit(32)::bigint) AS h
    FROM dataset_rows_flat f
    WHERE f.dataset_id = p_dataset_id
      AND ( (('x' || substr(md5(f.id::text || f.dataset_id::text), 1, 8))::bit(32)::bigint), f.id )
          > (p_after_hash, p_after_id)
    ORDER BY (('x' || substr(md5(f.id::text || f.dataset_id::text), 1, 8))::bit(32)::bigint), f.id
    LIMIT p_limit
  ),
  fld AS (SELECT taxonomy_primary_field(p_dataset_id) AS f),
  tp AS (
    SELECT (theme->>'id') AS tid,
           '\m(' || (SELECT string_agg(kw, '|') FROM jsonb_array_elements_text(theme->'keywords') AS kw WHERE kw <> '') || ')' AS pat
    FROM jsonb_array_elements(p_themes) AS theme
    WHERE jsonb_array_length(theme->'keywords') > 0
  ),
  matched AS (   -- (theme, row) where the row's text matches the theme
    SELECT DISTINCT tp.tid, page.id, page.data
    FROM page, tp, unnest(p_field_keys) AS fk(key)
    WHERE page.data ->> fk.key IS NOT NULL
      AND page.data ->> fk.key != ''
      AND page.data ->> fk.key ~* tp.pat
  ),
  dims AS (
    SELECT m.tid, ax.key::text AS axis, sb::text AS sub, count(*)::bigint AS cnt
    FROM matched m, fld,
         jsonb_each(m.data -> '_tx' -> 'f' -> fld.f -> 'a') AS ax(key, subs),
         jsonb_array_elements_text(ax.subs) AS sb
    GROUP BY m.tid, ax.key, sb
  )
  SELECT jsonb_build_object(
    'n_scanned', (SELECT count(*) FROM page),
    'dims',      COALESCE((SELECT jsonb_agg(jsonb_build_array(tid, axis, sub, cnt)) FROM dims), '[]'::jsonb),
    'last_hash', (SELECT h  FROM page ORDER BY h DESC, id DESC LIMIT 1),
    'last_id',   (SELECT id FROM page ORDER BY h DESC, id DESC LIMIT 1)
  );
$$;

-- grants → service_role only
DO $$
DECLARE fn text;
BEGIN
  FOR fn IN SELECT unnest(ARRAY[
    'topical_stopwords()',
    'sampled_theme_cooccurrence_page(uuid, text[], jsonb, bigint, bigint, int)',
    'sampled_theme_topical_page(uuid, text[], jsonb, text[], bigint, bigint, int)',
    'sampled_theme_dimension_page(uuid, text[], jsonb, bigint, bigint, int)'
  ])
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM anon, authenticated', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', fn);
  END LOOP;
END $$;

COMMIT;
