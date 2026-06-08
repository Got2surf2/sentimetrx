// @vitest-environment jsdom
//
// ModulePlaceholder — the "data loaded, module coming" panel for Charts/Stats.
// Pure render: pins the module name, message, formatted counts, and the
// Settings deep-link.

import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import ModulePlaceholder from '@/components/analyze/ModulePlaceholder'

describe('ModulePlaceholder', () => {
  it('renders the module name, message, and configured field count', () => {
    render(
      <ModulePlaceholder
        module="Charts"
        message="Charts are on the way"
        rowCount={1234}
        fieldCount={7}
        datasetId="ds_1"
      />,
    )
    expect(screen.getByRole('heading', { name: 'Charts' })).toBeTruthy()
    expect(screen.getByText('Charts are on the way')).toBeTruthy()
    expect(screen.getByText('7')).toBeTruthy()
  })

  it('formats the row count with thousands separators', () => {
    render(
      <ModulePlaceholder module="Stats" message="m" rowCount={1234567} fieldCount={3} datasetId="ds_2" />,
    )
    expect(screen.getByText('1,234,567')).toBeTruthy()
  })

  it('links to the dataset settings/schema page', () => {
    render(
      <ModulePlaceholder module="Stats" message="m" rowCount={10} fieldCount={2} datasetId="ds_abc" />,
    )
    const link = screen.getByRole('link', { name: /Configure schema/i }) as HTMLAnchorElement
    expect(link.getAttribute('href')).toBe('/analyze/ds_abc/settings')
  })
})
