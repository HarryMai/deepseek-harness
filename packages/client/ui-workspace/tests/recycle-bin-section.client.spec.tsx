// @vitest-environment jsdom
/** Recycle-bin actions remain confirmation-gated in the settings section. */

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SessionListState, SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { GlobalStandardProps } from '@deepseek-ai/dsh-client-ui-slots'
import type { WorkspaceSnapshot } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { RecycleBinSection } from '../src/client/RecycleBinSection.tsx'
import type { RecycleBinSectionProps } from '../src/client/RecycleBinSection.tsx'
import { zh } from '../src/client/recycle-bin-locales.ts'

const useResource = (() => ({ status: 'none' as const, value: undefined, failure: undefined, reload: () => {} })) as GlobalStandardProps['useResource']
const usePanelInfo: GlobalStandardProps['usePanelInfo'] = selector => selector({ activePanelId: null })
const sid = (id: string): SessionId => id as SessionId

afterEach(cleanup)

function hook<T>(snapshot: T) {
  return function select<S>(selector: (state: T) => S): S { return selector(snapshot) }
}

function sessionState(ids: readonly SessionId[]): SessionListState {
  const sessionIds = [...ids]
  const summaries: readonly SessionSummary[] = sessionIds.map(id => ({
    id,
    displayTitle: `会话 ${id}`,
    running: false,
    blank: false,
    updatedAt: 0,
  }))
  return {
    ids: sessionIds,
    byId: Object.fromEntries(summaries.map(summary => [summary.id, summary])),
    current: undefined,
    phase: 'ready',
    subagentsByParent: {},
    jobsBySession: {},
    currentAddress: undefined,
  }
}

function workspaceState(ids: readonly SessionId[]): WorkspaceSnapshot {
  return {
    items: [],
    archivedSessionIds: ids,
    recycleBinEntries: ids.map(sessionId => ({
      sessionId,
      archivedAt: '2026-09-18T00:00:00.000Z',
    })),
    state: 'idle',
    phase: 'ready',
    error: null,
  }
}

function mount(ids: readonly SessionId[] = [sid('one'), sid('two')]) {
  const restoreArchivedSessions = vi.fn(async () => undefined)
  const clearRecycleBin = vi.fn(async () => undefined)
  const saveRetentionDays = vi.fn(async () => undefined)
  const unusedHook = (() => { throw new Error('unused standard hook') }) as never
  const props: RecycleBinSectionProps = {
    useRecycleBinSettings: hook({
      status: 'ready', writable: true, retentionDays: 30, saving: false, failed: false,
    }),
    useWorkspaces: hook(workspaceState(ids)),
    useSessions: hook(sessionState(ids)),
    useSessionPendingInteraction: unusedHook,
    usePanelInfo,
    useResource,
    saveRetentionDays,
    restoreArchivedSessions,
    clearRecycleBin,
    t: makeTranslate(zh),
    close: () => {},
  }
  return { restoreArchivedSessions, clearRecycleBin, saveRetentionDays, ...render(<RecycleBinSection {...props} />) }
}

describe('RecycleBinSection', () => {
  it('does not restore a session until the user acknowledges the confirmation', async () => {
    const view = mount()

    fireEvent.click(screen.getAllByRole('button', { name: '恢复' })[0]!)
    const dialog = screen.getByRole('dialog', { name: '恢复会话' })
    const confirm = within(dialog).getByRole<HTMLButtonElement>('button', { name: '恢复' })
    expect(confirm.disabled).toBe(true)
    expect(view.restoreArchivedSessions).not.toHaveBeenCalled()

    fireEvent.click(within(dialog).getByRole('checkbox', { name: '我确认恢复所选会话。' }))
    expect(confirm.disabled).toBe(false)
    fireEvent.click(confirm)

    await waitFor(() => { expect(view.restoreArchivedSessions).toHaveBeenCalledWith(['one']) })
  })

  it('restores all selected sessions together only after confirmation', async () => {
    const view = mount()

    fireEvent.click(screen.getByRole('checkbox', { name: '全选' }))
    fireEvent.click(screen.getByRole('button', { name: '恢复所选 (2)' }))
    const dialog = screen.getByRole('dialog', { name: '恢复会话' })
    fireEvent.click(within(dialog).getByRole('checkbox', { name: '我确认恢复所选会话。' }))
    fireEvent.click(within(dialog).getByRole('button', { name: '恢复' }))

    await waitFor(() => { expect(view.restoreArchivedSessions).toHaveBeenCalledWith(['one', 'two']) })
  })

  it('does not clear the recycle bin until the user acknowledges the confirmation', async () => {
    const view = mount()

    fireEvent.click(screen.getByRole('button', { name: '清空回收站' }))
    const dialog = screen.getByRole('dialog', { name: '清空回收站' })
    const confirm = within(dialog).getByRole<HTMLButtonElement>('button', { name: '清空' })
    expect(confirm.disabled).toBe(true)
    expect(view.clearRecycleBin).not.toHaveBeenCalled()

    fireEvent.click(within(dialog).getByRole('checkbox', { name: '我确认清空回收站。' }))
    fireEvent.click(confirm)

    await waitFor(() => { expect(view.clearRecycleBin).toHaveBeenCalledOnce() })
  })

  it('passes a positive whole-day retention preference to its injected setting action', () => {
    const view = mount()

    fireEvent.change(screen.getByLabelText('保留天数'), { target: { value: '45' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    expect(view.saveRetentionDays).toHaveBeenCalledWith(45)
  })
})
