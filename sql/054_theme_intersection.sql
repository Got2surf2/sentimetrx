-- sql/054_theme_intersection.sql
-- Server-side primitives for theme card enrichment:
--   1. count_theme_intersection — pairwise "rows matching BOTH theme A
--      and theme B" counts, used to render the "Often appears with"
--      section.
--   2. extract_theme_topical_words — topical words near a theme's
--      keyword hits, with stopword / sentiment-adjective filtering done
--      in SQL. Replaces the previous client-side scan in TextMineModule.
--
-- Both functions mirror count_theme_matches' regex semantics (Postgres
-- \m word-boundary + alternation) so co-occurrence and topical-word
-- output stays consistent with theme record counts.

-- ============================================================
-- 1. Theme intersection — rows matching BOTH keyword sets
-- ============================================================
CREATE OR REPLACE FUNCTION count_theme_intersection(
  p_dataset_id uuid,
  p_field_keys text[],
  p_keywords_a text[],
  p_keywords_b text[]
)
RETURNS bigint AS $$
DECLARE
  pattern_a text;
  pattern_b text;
  total bigint;
BEGIN
  IF array_length(p_keywords_a, 1) IS NULL OR array_length(p_keywords_b, 1) IS NULL THEN
    RETURN 0;
  END IF;

  pattern_a := '\m(' || array_to_string(p_keywords_a, '|') || ')';
  pattern_b := '\m(' || array_to_string(p_keywords_b, '|') || ')';

  SELECT count(DISTINCT drf.id) INTO total
  FROM dataset_rows_flat drf
  WHERE drf.dataset_id = p_dataset_id
    AND EXISTS (
      SELECT 1 FROM unnest(p_field_keys) AS k
      WHERE drf.data ->> k IS NOT NULL
        AND drf.data ->> k != ''
        AND drf.data ->> k ~* pattern_a
    )
    AND EXISTS (
      SELECT 1 FROM unnest(p_field_keys) AS k
      WHERE drf.data ->> k IS NOT NULL
        AND drf.data ->> k != ''
        AND drf.data ->> k ~* pattern_b
    );

  RETURN total;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 2. Topical-word extraction
-- ============================================================
-- Pulls the most common content words that appear in rows matching a
-- theme. Excludes (a) the theme's own keywords, (b) a fixed stopword
-- list (articles, pronouns, auxiliaries, prepositions, generic
-- adjectives), and (c) a sentiment-adjective list — we want substantive
-- topical nouns/verbs, not sentiment color or filler.
--
-- Implementation: for each matching row, split text on \W+, unnest the
-- words, filter, group + count. Returns the top N words as a jsonb
-- array of [word, count] tuples. Approximate match to the client-side
-- ±2-window pass — server-side scan is broader (whole row text) but
-- cheaper than streaming rows to the browser; reviews tend to be short
-- enough that the difference is small in practice.
CREATE OR REPLACE FUNCTION extract_theme_topical_words(
  p_dataset_id uuid,
  p_field_keys text[],
  p_keywords text[],
  p_extra_excludes text[] DEFAULT ARRAY[]::text[],
  p_max_results int DEFAULT 5
)
RETURNS jsonb AS $$
DECLARE
  pattern text;
  result jsonb;
BEGIN
  IF array_length(p_keywords, 1) IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;

  pattern := '\m(' || array_to_string(p_keywords, '|') || ')';

  WITH matching_rows AS (
    SELECT DISTINCT drf.id, drf.data
    FROM dataset_rows_flat drf
    WHERE drf.dataset_id = p_dataset_id
      AND EXISTS (
        SELECT 1 FROM unnest(p_field_keys) AS k
        WHERE drf.data ->> k IS NOT NULL
          AND drf.data ->> k != ''
          AND drf.data ->> k ~* pattern
      )
  ),
  row_text AS (
    SELECT mr.id,
           string_agg(lower(coalesce(mr.data ->> k, '')), ' ') AS combined_text
    FROM matching_rows mr, unnest(p_field_keys) AS k
    GROUP BY mr.id
  ),
  words AS (
    SELECT unnest(regexp_split_to_array(combined_text, '[^a-z0-9'']+')) AS word
    FROM row_text
  ),
  filtered AS (
    SELECT word, count(*) AS cnt
    FROM words
    WHERE length(word) >= 3
      AND word !~ '^[0-9]+$'
      AND NOT (word = ANY(p_keywords))
      AND NOT (word = ANY(p_extra_excludes))
      AND word NOT IN (
        -- Stopwords + sentiment adjectives, kept in sync with the
        -- client-side lists. If you edit one, edit the other.
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
        -- Sentiment adjectives — covered by sentiment color, not topical
        'good','great','excellent','amazing','awesome','fantastic','wonderful','perfect','best','delicious','tasty','fresh','friendly','nice','lovely','clean','quick','fast','warm','crispy','tender','flavorful','juicy','rich','creamy','attentive','helpful','polite','outstanding','superb','incredible','comfortable','cozy','pleasant','enjoyable','reasonable','generous','authentic','exceptional','satisfying','refreshing','favorite','love','loved','recommend',
        'bad','terrible','horrible','awful','worst','poor','slow','cold','bland','dry','stale','rude','dirty','expensive','overpriced','small','loud','noisy','crowded','long','soggy','burnt','undercooked','overcooked','raw','greasy','salty','bitter','tasteless','mediocre','disappointing','disgusting','uncomfortable','unfriendly','unprofessional','filthy','gross','lukewarm','watery','tough','chewy','rubbery','hard','wrong','missing','broken','ignored','waited','annoyed','frustrated','underwhelming','overrated'
      )
    GROUP BY word
    ORDER BY count(*) DESC
    LIMIT p_max_results
  )
  SELECT coalesce(jsonb_agg(jsonb_build_array(word, cnt)), '[]'::jsonb)
    INTO result
  FROM filtered;

  RETURN result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- Verify
-- ============================================================
SELECT 'count_theme_intersection' AS func, 'ready' AS status
UNION ALL SELECT 'extract_theme_topical_words', 'ready';
