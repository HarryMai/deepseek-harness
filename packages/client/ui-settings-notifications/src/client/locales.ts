/** Localized copy for the personal mobile notification settings panel. */

/** Keys rendered by the mobile notification settings UI. */
export type NotificationSettingsKey =
  | 'tabLabel'
  | 'title'
  | 'intro'
  | 'loading'
  | 'unavailable'
  | 'readOnly'
  | 'masterLabel'
  | 'enabledDescription'
  | 'disabledDescription'
  | 'triggersHeading'
  | 'triggersHint'
  | 'eventApprovalTitle'
  | 'eventApprovalDesc'
  | 'eventManualActionTitle'
  | 'eventManualActionDesc'
  | 'eventPassiveInterruptionTitle'
  | 'eventPassiveInterruptionDesc'
  | 'eventTaskCompletedTitle'
  | 'eventTaskCompletedDesc'
  | 'channelsHeading'
  | 'channelsHint'
  | 'addChannel'
  | 'emptyChannels'
  | 'channelTitle'
  | 'channelEnabled'
  | 'testPush'
  | 'testingPush'
  | 'removeChannel'
  | 'providerLabel'
  | 'providerBark'
  | 'providerHint'
  | 'nameLabel'
  | 'namePlaceholder'
  | 'serverUrlLabel'
  | 'serverUrlPlaceholder'
  | 'serverUrlHint'
  | 'deviceKeyLabel'
  | 'deviceKeyPlaceholder'
  | 'deviceKeyHint'
  | 'showKey'
  | 'hideKey'
  | 'groupLabel'
  | 'groupPlaceholder'
  | 'soundLabel'
  | 'soundPlaceholder'
  | 'levelLabel'
  | 'levelAuto'
  | 'levelActive'
  | 'levelTimeSensitive'
  | 'levelPassive'
  | 'statusReady'
  | 'statusReadyActive'
  | 'statusDisabled'
  | 'statusMissingServerUrl'
  | 'statusInvalidServerUrl'
  | 'statusMissingDeviceKey'
  | 'statusUnsupportedProvider'
  | 'testSuccess'
  | 'testInvalidConfiguration'
  | 'testUnsupportedProvider'
  | 'testHttpError'
  | 'testRequestFailed'
  | 'testTimedOut'
  | 'testCancelled'
  | 'testUnavailable'
  | 'save'
  | 'saving'
  | 'discard'
  | 'unsaved'
  | 'saveFailed'

/** English copy (sentence case). */
export const en: Record<NotificationSettingsKey, string> = {
  tabLabel: 'Mobile notifications',
  title: 'Mobile notifications',
  intro: 'Push concise alerts to mobile devices when a task needs approval, requires manual action, stops unexpectedly, or completes.',
  loading: 'Loading notification settings…',
  unavailable: 'This application does not expose notification settings.',
  readOnly: 'This application stores settings read-only.',
  masterLabel: 'Enable mobile push notifications',
  enabledDescription: 'Enabled, valid channels will receive concise notifications for the selected events.',
  disabledDescription: 'Channel settings are retained, but no push notifications will be sent.',
  triggersHeading: 'Notification triggers',
  triggersHint: 'Choose which task events send a mobile alert. Messages include only the reason and a short task label.',
  eventApprovalTitle: 'Privilege approval required',
  eventApprovalDesc: 'Notify when execution pauses for human privilege escalation or tool approval.',
  eventManualActionTitle: 'Manual action required',
  eventManualActionDesc: 'Notify when execution waits for your reply, plan confirmation, or manual operation.',
  eventPassiveInterruptionTitle: 'Passive interruption (non-user)',
  eventPassiveInterruptionDesc: 'Notify when a task stops due to an error, guard block, or output limit; manual cancellation is excluded.',
  eventTaskCompletedTitle: 'Task completed',
  eventTaskCompletedDesc: 'Notify when a task finishes normally.',
  channelsHeading: 'Push channels',
  channelsHint: 'Stage 1 supports Bark Server (iOS). Future releases can add Android, HarmonyOS, and Xiaomi push channels.',
  addChannel: 'Add push channel',
  emptyChannels: 'No push channel has been configured yet.',
  channelTitle: 'Push channel',
  channelEnabled: 'Enable this channel',
  testPush: 'Send test',
  testingPush: 'Sending…',
  removeChannel: 'Remove',
  providerLabel: 'Push service',
  providerBark: 'Bark Server (iOS)',
  providerHint: 'Android, HarmonyOS, and Xiaomi push providers will appear here as additional options later.',
  nameLabel: 'Channel name',
  namePlaceholder: 'My iPhone',
  serverUrlLabel: 'Server URL',
  serverUrlPlaceholder: 'https://api.day.app',
  serverUrlHint: 'Official Bark endpoint or your self-hosted Bark server address (http:// or https://).',
  deviceKeyLabel: 'Device key',
  deviceKeyPlaceholder: 'Enter Bark device key',
  deviceKeyHint: 'Copy the key from the Bark app on your mobile device.',
  showKey: 'Show',
  hideKey: 'Hide',
  groupLabel: 'Group (optional)',
  groupPlaceholder: 'DSH',
  soundLabel: 'Sound (optional)',
  soundPlaceholder: 'minuet',
  levelLabel: 'Notification level',
  levelAuto: 'Automatic (by event urgency)',
  levelActive: 'Active (default)',
  levelTimeSensitive: 'Time sensitive',
  levelPassive: 'Passive (silent)',
  statusReady: 'Ready to push when the master switch is enabled.',
  statusReadyActive: 'Ready to push on selected events.',
  statusDisabled: 'This channel is off and will not receive notifications.',
  statusMissingServerUrl: 'Enter the push server URL before enabling this channel.',
  statusInvalidServerUrl: 'Enter a valid HTTP or HTTPS server URL.',
  statusMissingDeviceKey: 'Enter the device key before enabling this channel.',
  statusUnsupportedProvider: 'This push provider is not supported in the current build.',
  testSuccess: 'Test notification sent successfully.',
  testInvalidConfiguration: 'Complete the server URL and device key before testing.',
  testUnsupportedProvider: 'This push provider is not supported.',
  testHttpError: 'Push server returned an error (HTTP {status}).',
  testRequestFailed: 'Could not reach the push server. Check the server URL and network.',
  testTimedOut: 'Push test timed out.',
  testCancelled: 'Push test was cancelled.',
  testUnavailable: 'Push testing is available only from the local application.',
  save: 'Save',
  saving: 'Saving…',
  discard: 'Discard',
  unsaved: 'Unsaved changes',
  saveFailed: 'The application did not accept these changes. They remain here for you to correct.',
}

/** Simplified Chinese copy. */
export const zh: Record<NotificationSettingsKey, string> = {
  tabLabel: '消息通知',
  title: '消息通知',
  intro: '配置移动端消息推送通道；当任务需要人工提权、人工操作、非人为被动中断或完成时，向手机发送简洁提醒。',
  loading: '正在加载消息通知配置…',
  unavailable: '当前应用未开放消息通知配置。',
  readOnly: '当前应用的配置为只读。',
  masterLabel: '启用消息通知推送',
  enabledDescription: '总开关已开启；所有完整且已启用的推送通道将在选定事件发生时推送消息。',
  disabledDescription: '配置会保留，但不会向外发送任何消息通知。',
  triggersHeading: '推送时机',
  triggersHint: '选择触发推送的任务事件；推送内容仅包含推送原因与简洁任务标识，不携带详细正文。',
  eventApprovalTitle: '任务执行过程中需人工提权',
  eventApprovalDesc: '当任务需要人工审批权限或提权操作时推送通知',
  eventManualActionTitle: '任务执行过程中需人工操作',
  eventManualActionDesc: '当任务等待人工回复、确认方案或手动操作时推送通知',
  eventPassiveInterruptionTitle: '任务被动中断（非人为操作）',
  eventPassiveInterruptionDesc: '当任务因异常、策略拦截或输出上限中断时推送；手动取消不推送',
  eventTaskCompletedTitle: '任务已完成',
  eventTaskCompletedDesc: '当任务正常执行完成时推送通知',
  channelsHeading: '推送通道',
  channelsHint: '当前阶段已接入 Bark Server（iOS），后续可扩展接入安卓、鸿蒙、小米等移动端推送服务。',
  addChannel: '添加推送通道',
  emptyChannels: '尚未添加任何推送通道。',
  channelTitle: '推送通道',
  channelEnabled: '启用此通道',
  testPush: '测试推送',
  testingPush: '发送中…',
  removeChannel: '删除',
  providerLabel: '推送服务类型',
  providerBark: 'Bark Server（iOS）',
  providerHint: '后续接入安卓、鸿蒙、小米等推送通道后可在此切换类型。',
  nameLabel: '通道名称',
  namePlaceholder: '例如：我的 iPhone',
  serverUrlLabel: '服务地址',
  serverUrlPlaceholder: 'https://api.day.app',
  serverUrlHint: '填写官方 Bark 地址或自建 Bark Server 地址（http:// 或 https://）。',
  deviceKeyLabel: 'Device Key',
  deviceKeyPlaceholder: '请输入 Bark Device Key',
  deviceKeyHint: '从手机端 Bark 应用复制对应设备的 Key。',
  showKey: '显示',
  hideKey: '隐藏',
  groupLabel: '消息分组（可选）',
  groupPlaceholder: 'DSH',
  soundLabel: '提示音（可选）',
  soundPlaceholder: '例如：minuet',
  levelLabel: '通知级别',
  levelAuto: '自动（按事件重要程度）',
  levelActive: '普通提醒（active）',
  levelTimeSensitive: '时效性通知（timeSensitive）',
  levelPassive: '静默通知（passive）',
  statusReady: '此通道已就绪；打开总开关后即可推送消息。',
  statusReadyActive: '此通道已就绪，将在选定事件发生时推送消息。',
  statusDisabled: '此通道已关闭；保存后不会推送消息。',
  statusMissingServerUrl: '请填写推送服务地址后再启用。',
  statusInvalidServerUrl: '请输入有效的 HTTP 或 HTTPS 服务地址。',
  statusMissingDeviceKey: '请填写 Device Key 后再启用。',
  statusUnsupportedProvider: '当前版本暂不支持该推送服务类型。',
  testSuccess: '测试通知已发送，请在移动设备上查收。',
  testInvalidConfiguration: '请先补齐有效的服务地址和 Device Key。',
  testUnsupportedProvider: '当前暂不支持该推送服务类型。',
  testHttpError: '推送服务返回异常状态（HTTP {status}）。',
  testRequestFailed: '无法连接到推送服务，请检查服务地址和网络。',
  testTimedOut: '测试推送请求超时。',
  testCancelled: '测试推送已取消。',
  testUnavailable: '仅本地应用支持发送测试推送。',
  save: '保存',
  saving: '保存中…',
  discard: '放弃修改',
  unsaved: '未保存的修改',
  saveFailed: '应用未接受这些修改，内容仍保留在这里供你修正。',
}
