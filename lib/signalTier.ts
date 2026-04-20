// lib/signalTier.ts
// Computes signal_tier for Reddit and Substack datasets.
// Injects a 'signal_tier' categorical field on each row based on
// per-thread/post percentile ranking of score/likes.

// Canonical display order for signal tiers (highest engagement first)
export var SIGNAL_TIER_ORDER_SUBSTACK = ['Resonant', 'Discussed', 'Low Engagement', 'Ignored']
export var SIGNAL_TIER_ORDER_REDDIT = ['Mainstream', 'Controversial', 'Fringe', 'Noise']
// Combined set for detection
export var SIGNAL_TIER_ORDER = [...SIGNAL_TIER_ORDER_SUBSTACK, ...SIGNAL_TIER_ORDER_REDDIT]

export interface SignalCutoffs {
  mainstream: number  // default 70
  noise: number       // default 30
}

export var DEFAULT_SIGNAL_CUTOFFS: SignalCutoffs = { mainstream: 70, noise: 30 }

export function injectSignalTier(
  rows: Record<string, unknown>[],
  source: string,
  cutoffs?: SignalCutoffs
): Record<string, unknown>[] {
  if (source !== 'reddit' && source !== 'substack') return rows

  var c = cutoffs || DEFAULT_SIGNAL_CUTOFFS
  var isSubstack = source === 'substack'
  var groupKey = isSubstack ? 'post_title' : 'thread_id'
  var scoreKey = isSubstack ? 'likes' : 'score'

  // Group by thread/post
  var groups: Record<string, number[]> = {}
  rows.forEach(function(r, idx) {
    var gid = String(r[groupKey] || 'unknown')
    if (!groups[gid]) groups[gid] = []
    groups[gid].push(idx)
  })

  // Compute percentile within each group
  var tiers = new Array(rows.length)
  Object.values(groups).forEach(function(indices) {
    var sorted = [...indices].sort(function(a, b) {
      return (Number(rows[b][scoreKey]) || 0) - (Number(rows[a][scoreKey]) || 0)
    })
    var count = sorted.length
    sorted.forEach(function(idx, rank) {
      var percentile = count > 1 ? Math.round((1 - rank / (count - 1)) * 100) : 50
      var score = Number(rows[idx][scoreKey]) || 0
      var tier: string

      if (isSubstack) {
        var replies = Number(rows[idx].children_count) || 0
        if (percentile >= c.mainstream) tier = 'Resonant'
        else if (percentile >= c.noise || replies >= 3) tier = 'Discussed'
        else if (score === 0 && replies === 0) tier = 'Ignored'
        else tier = 'Low Engagement'
      } else {
        if (percentile >= c.mainstream) tier = 'Mainstream'
        else if (percentile >= c.noise) tier = 'Controversial'
        else if (score < 0) tier = 'Fringe'
        else tier = 'Noise'
      }
      tiers[idx] = tier
    })
  })

  var result: Record<string, unknown>[] = []
  for (var i = 0; i < rows.length; i++) {
    var copy: Record<string, unknown> = {}
    var keys = Object.keys(rows[i])
    for (var k = 0; k < keys.length; k++) copy[keys[k]] = rows[i][keys[k]]
    copy.signal_tier = tiers[i] || (isSubstack ? 'Ignored' : 'Noise')
    result.push(copy)
  }
  return result
}
