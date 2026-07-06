'use client'

// Participation tab — conversation dynamics for a diarized Town Hall meeting:
// per-speaker speaking share, turn-taking rhythm, floor changes, and a
// per-speaker floor ribbon. All numbers come from lib/recordings/participation
// (pure, deterministic — no AI); identity resolution mirrors the Transcript
// tab (speaker_names for mono voice clusters, channel_labels for true stereo,
// panel roster for the panel/community split).

import { useMemo } from 'react'
import { computeParticipation, fmtTalkTime, type ParticipationModel, type SpeakerStats } from '@/lib/recordings/participation'
import type { RecordingTranscriptRow, PanelMember } from '@/lib/recordings/types'

// Distinct ribbon/bar colors cycled across speakers (talk-time order).
const SPEAKER_COLORS = ['#E8632A', '#0F7173', '#2563EB', '#D97706', '#7C3AED', '#059669', '#DB2777', '#4A6572', '#B45309', '#0891B2']

interface Props {
  transcript: RecordingTranscriptRow | null
  speakerNames: Record<string, string> | null
  channelLabels: string[] | null
  audioChannels: number | null
  panel: PanelMember[]
  onPlay: (startSec: number | null, endSec: number | null, label: string) => void
}

export default function ParticipationTab({ transcript, speakerNames, channelLabels, audioChannels, panel, onPlay }: Props) {
  const model: ParticipationModel = useMemo(
    () => computeParticipation(transcript?.segments ?? null, { speakerNames, channelLabels, audioChannels, panel }),
    [transcript, speakerNames, channelLabels, audioChannels, panel],
  )

  if (!model.ok) {
    return (
      <div className="py-16 text-center text-sm text-gray-500">
        {model.reason === 'no_segments' ? (
          <>Participation analysis needs the processed transcript. It appears once transcription finishes.</>
        ) : (
          <>This transcript has no speaker separation (single-channel capture without diarization), so speaking share can&apos;t be computed. Recordings captured in stereo or transcribed with diarization get this panel automatically.</>
        )}
      </div>
    )
  }

  const hasPanelSplit = model.panelSharePct != null

  return (
    <div className="space-y-6">
      {/* KPI strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Kpi value={String(model.speakerCount)} label="Speakers" sub={hasPanelSplit ? `${model.speakers.filter(s => s.isPanel).length} panel` : undefined} />
        <Kpi value={Math.round(model.topSharePct) + '%'} label="Top-speaker share" sub={model.speakers[0]?.name} />
        <Kpi value={String(model.floorChanges)} label="Floor changes" sub={model.crosstalkCount > 0 ? `${model.crosstalkCount} crosstalk moments` : undefined} />
        <Kpi value={fmtTalkTime(model.quietSec)} label="Quiet time" sub={`of ${fmtTalkTime(model.durationSec)} total`} />
      </div>

      {hasPanelSplit && (
        <div>
          <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Panel vs community share of talk time</div>
          <div className="flex h-5 rounded-full overflow-hidden border border-gray-200" title={`Panel ${Math.round(model.panelSharePct!)}% · Community ${Math.round(model.audienceSharePct!)}%`}>
            <div className="bg-orange-500/80 flex items-center justify-center text-[10px] font-bold text-white" style={{ width: model.panelSharePct + '%' }}>
              {model.panelSharePct! >= 12 ? `Panel ${Math.round(model.panelSharePct!)}%` : ''}
            </div>
            <div className="bg-teal-600/80 flex-1 flex items-center justify-center text-[10px] font-bold text-white">
              {model.audienceSharePct! >= 12 ? `Community ${Math.round(model.audienceSharePct!)}%` : ''}
            </div>
          </div>
        </div>
      )}

      {/* Floor ribbon — one lane per speaker, bars = merged turns */}
      <div>
        <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Who held the floor</div>
        <div className="space-y-1">
          {model.speakers.map((s, i) => (
            <div key={s.key} className="flex items-center gap-2">
              <div className="w-32 shrink-0 truncate text-xs text-gray-600 text-right" title={s.name}>{s.name || s.key}</div>
              <div className="relative h-4 flex-1 rounded bg-gray-100 overflow-hidden">
                {s.turns.map((t, j) => (
                  <div
                    key={j}
                    className="absolute top-0 h-full rounded-[2px]"
                    style={{
                      left: (t.start / model.durationSec) * 100 + '%',
                      width: Math.max(((t.end - t.start) / model.durationSec) * 100, 0.15) + '%',
                      background: SPEAKER_COLORS[i % SPEAKER_COLORS.length],
                    }}
                    title={`${s.name || s.key} · ${fmtTalkTime(t.start)}–${fmtTalkTime(t.end)}`}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="flex justify-between text-[10px] text-gray-400 mt-1" style={{ paddingLeft: '8.5rem' }}>
          <span>0:00</span>
          <span>{fmtTalkTime(model.durationSec / 2)}</span>
          <span>{fmtTalkTime(model.durationSec)}</span>
        </div>
      </div>

      {/* Per-speaker table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-gray-500 uppercase tracking-wide border-b border-gray-200">
              <th className="py-2 pr-3 font-semibold">Speaker</th>
              <th className="py-2 pr-3 font-semibold">Talk time</th>
              <th className="py-2 pr-3 font-semibold w-[26%]">Share</th>
              <th className="py-2 pr-3 font-semibold text-right">Turns</th>
              <th className="py-2 pr-3 font-semibold text-right">Avg turn</th>
              <th className="py-2 pr-3 font-semibold text-right">Longest turn</th>
              <th className="py-2 pr-0 font-semibold text-right">Pace</th>
            </tr>
          </thead>
          <tbody>
            {model.speakers.map((s, i) => (
              <SpeakerRow key={s.key} s={s} color={SPEAKER_COLORS[i % SPEAKER_COLORS.length]} onPlay={onPlay} />
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-gray-400">
        Share is of total speaking time, not wall clock. Turns merge segments by the same speaker separated by less than 2 seconds; quiet time counts gaps of 3+ seconds.
        {hasPanelSplit ? ' Panel matching uses the meeting setup roster and assigned speaker names.' : ' Assign speaker names that match the setup roster to unlock the panel vs community split.'}
      </p>
    </div>
  )
}

function Kpi({ value, label, sub }: { value: string; label: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
      <div className="text-2xl font-bold text-gray-900">{value}</div>
      <div className="text-xs font-medium text-gray-600">{label}</div>
      {sub && <div className="text-[11px] text-gray-400 truncate" title={sub}>{sub}</div>}
    </div>
  )
}

function SpeakerRow({ s, color, onPlay }: { s: SpeakerStats; color: string; onPlay: Props['onPlay'] }) {
  return (
    <tr className="border-b border-gray-100">
      <td className="py-2 pr-3">
        <span className="inline-block w-2.5 h-2.5 rounded-full mr-2 align-middle" style={{ background: color }} />
        <span className="font-medium text-gray-800 align-middle">{s.name || s.key}</span>
        {s.isPanel && (
          <span className="ml-2 inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-orange-100 text-orange-700 align-middle">Panel</span>
        )}
      </td>
      <td className="py-2 pr-3 tabular-nums text-gray-700">{fmtTalkTime(s.talkSec)}</td>
      <td className="py-2 pr-3">
        <div className="flex items-center gap-2">
          <div className="h-2 flex-1 rounded-full bg-gray-100 overflow-hidden">
            <div className="h-full rounded-full" style={{ width: Math.max(s.sharePct, 0.5) + '%', background: color }} />
          </div>
          <span className="text-xs tabular-nums text-gray-600 w-9 text-right">{s.sharePct >= 9.5 ? Math.round(s.sharePct) : s.sharePct.toFixed(1)}%</span>
        </div>
      </td>
      <td className="py-2 pr-3 text-right tabular-nums text-gray-700">{s.turnCount}</td>
      <td className="py-2 pr-3 text-right tabular-nums text-gray-700">{fmtTalkTime(s.avgTurnSec)}</td>
      <td className="py-2 pr-3 text-right tabular-nums">
        <button
          type="button"
          className="text-orange-700 hover:underline tabular-nums"
          title={`Play the longest turn (starts at ${fmtTalkTime(s.longestTurnStart)})`}
          onClick={() => onPlay(s.longestTurnStart, s.longestTurnStart + s.longestTurnSec, `${s.name || s.key} — longest turn`)}
        >
          {fmtTalkTime(s.longestTurnSec)}
        </button>
      </td>
      <td className="py-2 pr-0 text-right tabular-nums text-gray-700">{s.wpm > 0 ? Math.round(s.wpm) + ' wpm' : '—'}</td>
    </tr>
  )
}
