/** Locale dictionary for the Workspace recycle-bin settings section. */

/** Simplified Chinese dictionary and key-set source of truth. */
export const zh = {
  nav: '回收站',
  title: '回收站',
  retentionLabel: '保留天数',
  retentionSave: '保存',
  retentionInvalid: '请输入大于 0 的整数天数。',
  retentionFailed: '无法保存保留期设置。',
  loading: '正在加载回收站设置…',
  unavailable: '当前配置不可用。',
  readOnly: '当前配置为只读。',
  selectAll: '全选',
  restoreSelected: '恢复所选 ({count})',
  clearAll: '清空回收站',
  empty: '回收站为空。',
  archivedAt: '归档于 {time}',
  restoreOne: '恢复',
  restoreTitle: '恢复会话',
  restoreDescription: '恢复后，这些会话会重新出现在原来的工作区位置。',
  restoreAcknowledgement: '我确认恢复所选会话。',
  restoreConfirm: '恢复',
  clearTitle: '清空回收站',
  clearDescription: '清空后，这些会话将无法从应用内恢复。',
  clearAcknowledgement: '我确认清空回收站。',
  clearConfirm: '清空',
  cancel: '取消',
  close: '关闭',
  operationFailed: '操作未完成，请重试。',
} satisfies Record<string, string>

/** Key union for the recycle-bin locale namespace. */
export type RecycleBinKey = keyof typeof zh

/** English dictionary, checked complete against the Chinese key set. */
export const en = {
  nav: 'Recycle bin',
  title: 'Recycle bin',
  retentionLabel: 'Keep for days',
  retentionSave: 'Save',
  retentionInvalid: 'Enter a whole number greater than 0.',
  retentionFailed: 'Could not save the retention setting.',
  loading: 'Loading recycle-bin settings…',
  unavailable: 'Configuration is unavailable.',
  readOnly: 'Configuration is read-only.',
  selectAll: 'Select all',
  restoreSelected: 'Restore selected ({count})',
  clearAll: 'Empty recycle bin',
  empty: 'The recycle bin is empty.',
  archivedAt: 'Archived {time}',
  restoreOne: 'Restore',
  restoreTitle: 'Restore sessions',
  restoreDescription: 'Restored sessions return to their original workspace positions.',
  restoreAcknowledgement: 'I confirm that I want to restore the selected sessions.',
  restoreConfirm: 'Restore',
  clearTitle: 'Empty recycle bin',
  clearDescription: 'Sessions emptied from here cannot be restored in the application.',
  clearAcknowledgement: 'I confirm that I want to empty the recycle bin.',
  clearConfirm: 'Empty',
  cancel: 'Cancel',
  close: 'Close',
  operationFailed: 'The operation did not complete. Try again.',
} satisfies Record<RecycleBinKey, string>
